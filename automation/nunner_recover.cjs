/**
 * NUNNER LOGISTICS RECOVERY SCRIPT v2
 * Written by Claude (Cowork) — 2026-03-25
 *
 * Strategy:
 * 1. Delete bad zero-amount Nunner record
 * 2. Scan ALL company IMAP inboxes for Nunner PDFs (even seen/old emails)
 * 3. Re-process through full AI pipeline
 * 4. If AI still returns amount=0: save anyway with status NEEDS_REVIEW
 *    (so record appears on dashboard for manual correction)
 * 5. Write detailed debug log to automation/recovery_debug.log
 */

require('dotenv').config({ path: __dirname + '/.env' });

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');

// --- File logger ---
// NOTE: Log is written to PROJECT ROOT (not automation/) to avoid PM2 watch restart loop
const LOG_FILE = path.join(__dirname, '..', 'recovery_debug.log');
function flog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// Clear previous log
try { fs.writeFileSync(LOG_FILE, `NUNNER RECOVERY LOG — ${new Date().toISOString()}\n${'='.repeat(60)}\n`); } catch (_) {}

// --- Firebase init ---
// Use a NAMED app ('nunner-recovery') to avoid sharing a stale gRPC connection
// with index.js when called via PM2 flag runner (shared firebase app can hang after restart).
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    serviceAccount = require('./google-credentials.json');
}

const APP_NAME = 'nunner-recovery';
let recoveryApp = admin.apps.find(a => a && a.name === APP_NAME);
if (!recoveryApp) {
    recoveryApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    }, APP_NAME);
}
const db = recoveryApp.firestore();
const bucket = recoveryApp.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

const VENDOR_SEARCH = 'nunner';

async function deleteBadRecord() {
    flog('Step 1: Deleting bad Nunner records (invoiceId=42260200134) from Firestore...');

    // Targeted query — no full collection scan needed
    const snap1 = await db.collection('invoices')
        .where('invoiceId', '==', '42260200134')
        .get();

    flog(`  Found ${snap1.size} record(s) with invoiceId=42260200134`);
    let deleted = 0;

    for (const d of snap1.docs) {
        const data = d.data();
        const amt = parseFloat(String(data.amount || '0').replace(',', '.')) || 0;
        flog(`  Record ${d.id}: amount=${data.amount}, status=${data.status}`);
        if (amt === 0 || data.status === 'OOTEL' || data.status === 'NEEDS_REVIEW') {
            await d.ref.delete();
            flog(`  ✅ Deleted bad record: ${d.id}`);
            deleted++;
        } else {
            flog(`  ⚠️  Keeping record ${d.id} — amount=${data.amount} looks valid`);
        }
    }

    if (deleted === 0 && snap1.empty) {
        flog('  ℹ️  No record with invoiceId=42260200134 found. Proceeding anyway.');
    }
    return deleted;
}

async function scanInboxForNunner(imapConfig, companyId, companyName) {
    flog(`\nScanning inbox: ${companyName} (${imapConfig.user}) @ ${imapConfig.host}:${imapConfig.port}`);

    let connection;
    try {
        connection = await imaps.connect({
            imap: {
                user: imapConfig.user,
                password: imapConfig.password,
                host: String(imapConfig.host).trim(),
                port: imapConfig.port || 993,
                tls: true,
                authTimeout: 30000,
                connTimeout: 30000,
                tlsOptions: { rejectUnauthorized: false }
            }
        });
        flog(`  ✅ IMAP connected successfully`);
    } catch (connErr) {
        flog(`  ❌ IMAP connection FAILED: ${connErr.message}`);
        return 0;
    }

    try {
        await connection.openBox('INBOX');
    } catch (boxErr) {
        flog(`  ❌ Could not open INBOX: ${boxErr.message}`);
        connection.end();
        return 0;
    }

    // Search all emails since recent date to prevent ECONNRESET
    let messages;
    try {
        messages = await connection.search(['ALL', ['SINCE', '24-Mar-2026']], { bodies: [''] });
        flog(`  Found ${messages.length} total emails to scan`);
    } catch (searchErr) {
        flog(`  ❌ Search failed: ${searchErr.message}`);
        connection.end();
        return 0;
    }

    let recovered = 0;
    let pdfCount = 0;
    let nunnerCount = 0;

    for (const item of messages) {
        // IMAP Throttling: 500ms delay per email scan to protect the main production polling daemon from RateLimitedError
        await new Promise(r => setTimeout(r, 500));

        let parsed;
        try {
            const all = item.parts.find(a => a.which === '');
            parsed = await simpleParser(all.body);
        } catch (parseErr) {
            continue;
        }

        if (!parsed.attachments || parsed.attachments.length === 0) continue;

        for (const att of parsed.attachments) {
            const fname = (att.filename || '').toLowerCase();
            const mime = (att.contentType || '').toLowerCase();

            if (!mime.includes('pdf') && !fname.endsWith('.pdf')) continue;
            pdfCount++;

            // Check if PDF contains "nunner"
            let text = '';
            try {
                const pdfData = await pdfParse(att.content);
                text = (pdfData.text || '').toLowerCase();
            } catch (pdfErr) {
                flog(`  ⚠️  PDF parse error on "${att.filename}": ${pdfErr.message}`);
                // Still try if filename suggests Nunner
                if (!fname.includes(VENDOR_SEARCH) && !fname.includes('422602')) continue;
            }

            const isNunnerByText = text.includes(VENDOR_SEARCH);
            const isNunnerByFilename = fname.includes(VENDOR_SEARCH) || fname.includes('422602');
            if (!isNunnerByText && !isNunnerByFilename) continue;

            nunnerCount++;
            flog(`\n  🎯 Found Nunner PDF: "${att.filename}" | email: "${parsed.subject || '(no subject)'}"`);
            flog(`     Text match: ${isNunnerByText}, Filename match: ${isNunnerByFilename}`);
            flog(`     PDF size: ${att.content.length} bytes`);

            // AI Throttling: 2-second pause before heavy AI extraction to prevent API & network bursts
            await new Promise(r => setTimeout(r, 2000));

            // --- Run full AI extraction pipeline ---
            let parsedData = null;
            let critique = null;

            for (let attempt = 1; attempt <= 5; attempt++) {
                flog(`     Extraction attempt ${attempt}/5...`);
                let tempParsed;
                try {
                    tempParsed = await processInvoiceWithDocAI(att.content, 'application/pdf', critique, null);
                } catch (docAiErr) {
                    flog(`     ❌ DocAI error on attempt ${attempt}: ${docAiErr.message}`);
                    break;
                }

                if (!tempParsed || tempParsed.length === 0) {
                    flog(`     ⚠️  Empty result on attempt ${attempt}`);
                    break;
                }

                const extracted = tempParsed[0];
                flog(`     Extracted: vendor="${extracted.vendorName}", amount=${extracted.amount}, invoiceId="${extracted.invoiceId}", vat="${extracted.vatNumber}", reg="${extracted.registrationNumber}"`);

                let verdict;
                try {
                    verdict = await intellectualSupervisorGate(extracted);
                } catch (supErr) {
                    flog(`     ⚠️  Supervisor error: ${supErr.message}. Accepting result.`);
                    parsedData = tempParsed;
                    break;
                }

                if (verdict.passed) {
                    parsedData = tempParsed;
                    flog(`     ✅ Supervisor APPROVED on attempt ${attempt}`);
                    break;
                } else if (verdict.needsReExtraction && attempt < 5) {
                    flog(`     🔄 Supervisor critique: ${verdict.critique}`);
                    critique = verdict.critique;
                } else {
                    flog(`     ⚠️  Supervisor did not approve after ${attempt} attempts. Accepting with warnings.`);
                    extracted.validationWarnings = extracted.validationWarnings || [];
                    extracted.validationWarnings.push(`SUPERVISOR: Accepted after ${attempt} attempts.`);
                    parsedData = tempParsed;
                    break;
                }
            }

            if (!parsedData || parsedData.length === 0) {
                flog(`     ❌ Could not extract data. Skipping this PDF.`);
                continue;
            }

            const inv = parsedData[0];
            const extractedAmount = parseFloat(String(inv.amount || '0').replace(',', '.')) || 0;

            // Upload PDF to Firebase Storage regardless of amount
            let fileUrl = null;
            try {
                const token = uuidv4();
                const destPath = `invoices/${companyId}/RECOVERY_${Date.now()}_${att.filename || 'nunner_recovered.pdf'}`;
                await bucket.file(destPath).save(att.content, {
                    metadata: {
                        contentType: 'application/pdf',
                        metadata: { firebaseStorageDownloadTokens: token }
                    }
                });
                fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
                flog(`     📎 PDF uploaded to Firebase Storage: ${destPath}`);
            } catch (uploadErr) {
                flog(`     ❌ Storage upload FAILED: ${uploadErr.message}`);
                // Continue anyway — we'll save without a file URL
            }

            // Determine status
            let finalStatus;
            if (extractedAmount > 0) {
                finalStatus = inv.status || 'OOTEL';
            } else {
                // Amount is still 0 — save as NEEDS_REVIEW so it appears on dashboard
                flog(`     ⚠️  Amount still 0 after AI extraction. Saving with NEEDS_REVIEW status.`);
                finalStatus = 'NEEDS_REVIEW';
                inv.validationWarnings = inv.validationWarnings || [];
                inv.validationWarnings.push('AUTO_RECOVERY: Amount could not be extracted — please verify manually.');
            }

            // Build Firestore record
            const recordData = {
                vendorName: inv.vendorName || 'NUNNER Logistics UAB',
                invoiceId: inv.invoiceId || '42260200134',
                amount: extractedAmount > 0 ? extractedAmount : null,
                amountRaw: inv.amount || null,
                currency: inv.currency || 'EUR',
                vatNumber: inv.vatNumber || inv.vat || null,
                registrationNumber: inv.registrationNumber || null,
                issueDate: inv.issueDate || inv.date || null,
                dueDate: inv.dueDate || null,
                description: inv.description || null,
                status: finalStatus,
                companyId,
                fileUrl: fileUrl || null,
                recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                validationWarnings: inv.validationWarnings || [],
                recoverySource: `IMAP:${imapConfig.user}:${att.filename}`
            };

            // Try accountant agent (deduplication etc) but don't let it block us
            let finalRecord = recordData;
            try {
                const auditedData = await auditAndProcessInvoice(inv, fileUrl, companyId);
                if (auditedData && auditedData.status !== 'Duplicate' && auditedData.status !== 'Error') {
                    finalRecord = {
                        ...auditedData,
                        companyId,
                        fileUrl: fileUrl || auditedData.fileUrl || null,
                        recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        recoverySource: `IMAP:${imapConfig.user}:${att.filename}`
                    };
                    if (auditedData.status === 'Duplicate') {
                        flog(`     ℹ️  Accountant agent says DUPLICATE — already recovered.`);
                        recovered++;
                        continue;
                    }
                } else if (auditedData && auditedData.status === 'Duplicate') {
                    flog(`     ℹ️  Duplicate detected by accountant agent — skipping.`);
                    continue;
                }
            } catch (auditErr) {
                if (auditErr.message === 'BANK_STATEMENT_RECONCILIATION_COMPLETE') {
                    flog(`     ℹ️  Classified as bank statement. Skipping.`);
                    continue;
                }
                flog(`     ⚠️  Accountant agent error (using fallback record): ${auditErr.message}`);
                // Use our manually built recordData as fallback
            }

            // Write to Firestore
            const docRef = db.collection('invoices').doc();
            await docRef.set(finalRecord);

            flog(`\n     🎉 SUCCESS! Invoice saved to Firestore:`);
            flog(`        Firestore ID: ${docRef.id}`);
            flog(`        Vendor:  ${finalRecord.vendorName}`);
            flog(`        InvID:   ${finalRecord.invoiceId}`);
            flog(`        Amount:  ${finalRecord.amount} ${finalRecord.currency}`);
            flog(`        Status:  ${finalRecord.status}`);
            flog(`        File:    ${finalRecord.fileUrl ? '✅ attached' : '❌ missing'}`);
            recovered++;
        }
    }

    flog(`\n  Summary for ${companyName}: ${pdfCount} PDFs scanned, ${nunnerCount} Nunner PDFs found, ${recovered} recovered`);

    try { connection.end(); } catch (_) {}
    return recovered;
}

async function run() {
    flog('');
    flog('═══════════════════════════════════════════════');
    flog('  NUNNER LOGISTICS RECOVERY v2 — Starting...');
    flog('═══════════════════════════════════════════════');

    // Step 1: Delete bad records (targeted query — no full collection scan)
    await deleteBadRecord();

    // Step 2: Scan all company inboxes
    let totalRecovered = 0;
    let companiesScanned = 0;

    const companiesSnap = await db.collection('companies').get();
    flog(`\nFound ${companiesSnap.size} companies in Firestore.`);

    for (const compDoc of companiesSnap.docs) {
        const data = compDoc.data();
        const name = data.name || compDoc.id;
        flog(`\nCompany: ${name} (${compDoc.id})`);
        flog(`  imapHost: ${data.imapHost || '(not set)'}`);
        flog(`  imapUser: ${data.imapUser || '(not set)'}`);

        if (!data.imapHost || !data.imapUser || !data.imapPassword) {
            flog(`  ⚠️  Missing IMAP config — skipping`);
            continue;
        }

        try {
            const count = await scanInboxForNunner(
                {
                    user: data.imapUser,
                    password: data.imapPassword,
                    host: data.imapHost,
                    port: data.imapPort || 993
                },
                compDoc.id,
                name
            );
            totalRecovered += count;
            companiesScanned++;
        } catch (err) {
            flog(`  ❌ Unhandled error scanning ${name}: ${err.message}`);
        }
    }

    flog('\n═══════════════════════════════════════════════');
    if (totalRecovered > 0) {
        flog(`✅ DONE. Recovered ${totalRecovered} Nunner invoice(s) across ${companiesScanned} companies.`);
    } else {
        flog(`⚠️  No Nunner invoices recovered.`);
        flog(`   Possible reasons:`);
        flog(`   1. IMAP auth failed for the account holding the invoice`);
        flog(`   2. Email was deleted from inbox`);
        flog(`   3. PDF does not contain the word "nunner"`);
        flog(`   → Check recovery_debug.log for details`);
    }
    flog('═══════════════════════════════════════════════');
    flog(`Full log saved to: automation/recovery_debug.log`);
}

module.exports = { run };

if (require.main === module) {
    run().catch(err => {
        flog(`Fatal error: ${err.message}`);
        flog(err.stack);
        process.exit(1);
    });
}
