#!/usr/bin/env node
/**
 * Re-extract specific invoices through Scout (DocAI) → Teacher pipeline.
 * Downloads original PDF from fileUrl, re-runs extraction, updates Firestore.
 *
 * Usage:
 *   node reextract_by_ids.cjs <id1> <id2> ...        # re-extract specific invoice IDs
 *   node reextract_by_ids.cjs --dry-run <id1> ...     # show what DocAI returns, don't write
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const http = require('http');
const { admin, db } = require('./core/firebase.cjs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { validateAndTeach } = require('./teacher_agent.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const ids = args.filter(a => !a.startsWith('--'));

if (ids.length === 0) {
    console.error('Usage: node reextract_by_ids.cjs [--dry-run] <firestoreId1> <firestoreId2> ...');
    process.exit(1);
}

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'InvoiceTracker/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function downloadFromStorage(storageUrl) {
    const bucket = admin.storage().bucket();
    let filePath;
    if (storageUrl.startsWith('gs://')) {
        filePath = storageUrl.replace(/^gs:\/\/[^/]+\//, '');
    } else {
        const urlObj = new URL(storageUrl);
        filePath = decodeURIComponent(urlObj.pathname.split('/o/')[1]);
    }
    const [buffer] = await bucket.file(filePath).download();
    return buffer;
}

(async () => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Re-extraction: ${ids.length} invoice(s) ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'═'.repeat(60)}\n`);

    let ok = 0, fail = 0;

    for (const id of ids) {
        console.log(`─── ${id} ───`);
        const snap = await db.collection('invoices').doc(id).get();
        if (!snap.exists) { console.error(`  ❌ Not found`); fail++; continue; }

        const inv = snap.data();
        console.log(`  Vendor: ${inv.vendorName} | Invoice: ${inv.invoiceId} | ${inv.amount} ${inv.currency}`);

        // Download original file
        let fileBuffer;
        try {
            if (inv.fileUrl) {
                fileBuffer = await downloadFile(inv.fileUrl);
            } else if (inv.stagingId) {
                const staged = await db.collection('raw_documents').doc(inv.stagingId).get();
                if (staged.exists && staged.data().storageUrl) {
                    fileBuffer = await downloadFromStorage(staged.data().storageUrl);
                }
            }
        } catch (err) {
            console.error(`  ❌ Download failed: ${err.message}`);
            fail++;
            continue;
        }

        if (!fileBuffer) {
            console.error(`  ❌ No file available`);
            fail++;
            continue;
        }

        console.log(`  📄 File downloaded (${(fileBuffer.length / 1024).toFixed(0)} KB)`);

        // Scout: DocAI extraction
        let extracted;
        try {
            extracted = await processInvoiceWithDocAI(fileBuffer, 'application/pdf');
            extracted = Array.isArray(extracted) ? extracted[0] : extracted;
        } catch (err) {
            console.error(`  ❌ DocAI failed: ${err.message}`);
            fail++;
            continue;
        }

        console.log(`  Scout → vendor="${extracted.vendorName}", invoiceId="${extracted.invoiceId}", amount=${extracted.amount} ${extracted.currency}`);
        console.log(`          VAT=${extracted.supplierVat}, Reg=${extracted.supplierRegistration}`);

        // Teacher: validate and correct
        let teacherResult;
        try {
            teacherResult = await validateAndTeach(extracted, inv.companyId);
        } catch (err) {
            console.error(`  ❌ Teacher failed: ${err.message}`);
            fail++;
            continue;
        }

        const final = teacherResult.invoice || extracted;
        console.log(`  Teacher → vendor="${final.vendorName}", VAT=${final.supplierVat}, Reg=${final.supplierRegistration}`);
        if (teacherResult.corrections?.length) {
            for (const c of teacherResult.corrections) console.log(`    📝 ${c}`);
        }

        // Accountant: non-invoice filter, VIES, dedup, etc.
        let audited;
        try {
            audited = await auditAndProcessInvoice(final, inv.fileUrl, inv.companyId);
        } catch (err) {
            if (err.message === 'BANK_STATEMENT_RECONCILIATION_COMPLETE') {
                console.log(`  ℹ️ Bank statement — skipping`);
                continue;
            }
            console.error(`  ❌ Accountant failed: ${err.message}`);
            fail++;
            continue;
        }

        if (!audited) {
            // Accountant rejected (non-invoice, junk, etc.) → delete the bad record
            console.log(`  🛑 Accountant rejected — record will be deleted`);
            if (!dryRun) {
                await db.collection('invoices').doc(id).delete();
                console.log(`  🗑️  Deleted ${id}`);
            }
            ok++;
            continue;
        }

        if (dryRun) {
            console.log(`  🔍 DRY RUN — not writing.`);
            ok++;
            continue;
        }

        // Write back: only update extraction fields, preserve status/manual edits
        const update = {};
        const FIELDS = ['vendorName', 'invoiceId', 'amount', 'currency', 'dateCreated', 'dueDate',
                        'subtotalAmount', 'taxAmount', 'supplierVat', 'supplierRegistration', 'description'];

        for (const f of FIELDS) {
            if (final[f] !== undefined && final[f] !== null && final[f] !== '' && final[f] !== 'Not_Found') {
                // Don't overwrite manually edited records unless field was empty
                if (inv.manuallyEdited && inv[f] && inv[f] !== 'Not_Found' && inv[f] !== 'Unknown Vendor') {
                    continue;
                }
                update[f] = final[f];
            }
        }

        update.reExtractedAt = admin.firestore.FieldValue.serverTimestamp();
        update.teacherCorrections = teacherResult.corrections || [];

        await db.collection('invoices').doc(id).update(update);
        console.log(`  ✅ Updated ${Object.keys(update).length} field(s)`);
        ok++;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Done: ${ok} ok, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
})();
