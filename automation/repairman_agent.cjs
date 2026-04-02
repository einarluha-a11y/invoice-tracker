#!/usr/bin/env node
/**
 * РЕМОНТНИК (Repairman Agent) v3
 *
 * Key principle: NEVER delete invoice records. Always UPDATE in place.
 * If manuallyEdited=true, only fill empty fields — never overwrite manual corrections.
 *
 * Modes:
 *   --mode full       (default) Find all anomalies + re-extract from original file
 *   --mode skeletons  Find records without fileUrl
 *   --mode statuses   Find records with problematic statuses
 *
 * Options:
 *   --fix             Execute repairs (default is dry-run)
 *   --date YYYY-MM-DD Single date
 *   --since / --until Date range
 *   --company <id>    Filter by company
 *   --skip-imap       Skip IMAP file retrieval
 *
 * Usage:
 *   node repairman_agent.cjs                                    # dry-run, full mode
 *   node repairman_agent.cjs --mode skeletons --fix
 *   node repairman_agent.cjs --since 2026-03-23 --until 2026-03-30 --fix
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const http = require('http');
const { admin, db, bucket } = require('./core/firebase.cjs');
const {
    logRepair, incrementRepairAttempts, getRepairAttempts, markRepairPending,
    getStagedDocument,
} = require('./core/staging.cjs');

// ─── CLI Arguments ───────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const getArg   = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (n) => args.includes(n);

const mode          = getArg('--mode') || 'full';
const dryRun        = !hasFlag('--fix');
const skipImap      = hasFlag('--skip-imap');
const companyFilter = getArg('--company');
const dateArg       = getArg('--date');
let sinceArg        = getArg('--since');
let untilArg        = getArg('--until');

if (dateArg) { sinceArg = dateArg; untilArg = dateArg; }

const PROBLEM_STATUSES = [
    'NEEDS_REVIEW', 'Needs Action', 'needs action',
    'OOTEL', 'KARANTIIN', 'Karantine', 'Karantiin', 'Карантин',
    'ANOMALY_DETECTED', 'Error',
];

const MAX_REPAIR_ATTEMPTS = 2;

const EMPTY_VALUES = ['', 'Not_Found', 'Unknown Vendor', 'UNKNOWN VENDOR', 'Unknown', null, undefined];
function isEmpty(val) {
    if (EMPTY_VALUES.includes(val)) return true;
    if (typeof val === 'number' && val === 0) return true;
    if (typeof val === 'string' && val.startsWith('Auto-')) return true;
    return false;
}

// ─── Detection Logic ─────────────────────────────────────────────────────────

async function findBadInvoices() {
    if (mode === 'statuses') return findBadStatuses();

    let q = db.collection('invoices').orderBy('createdAt', 'desc').limit(5000);
    if (companyFilter) q = q.where('companyId', '==', companyFilter);
    if (sinceArg) q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(sinceArg)));
    if (untilArg) q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(untilArg + 'T23:59:59.999Z')));

    const snap = await q.get();
    const bad = [];
    for (const doc of snap.docs) {
        const d = doc.data();
        const reasons = detectProblems(d);
        if (reasons.length > 0) bad.push({ id: doc.id, data: d, reason: reasons.join(' + ') });
    }
    return bad;
}

function detectProblems(d) {
    const hasMissingFile   = !d.fileUrl || d.fileUrl === 'BODY_TEXT_NO_ATTACHMENT';
    const hasZeroAmount    = !d.amount || Number(d.amount) === 0;
    const isMissingIdentity = (!d.supplierVat || d.supplierVat === 'Not_Found') &&
                              (!d.supplierRegistration || d.supplierRegistration === 'Not_Found');
    const isStuck = (d.status === 'NEEDS_REVIEW' || d.status === 'DRAFT') && hasMissingFile;

    // Data quality checks
    const hasUnknownVendor = isEmpty(d.vendorName);
    const hasSameDates = d.dateCreated && d.dueDate && d.dateCreated === d.dueDate;
    const hasMissingDescription = isEmpty(d.description);
    const hasZeroTaxOnTaxableAmount = Number(d.amount) > 0 && Number(d.subtotalAmount) > 0
        && Number(d.taxAmount) === 0 && Number(d.amount) === Number(d.subtotalAmount);

    const reasons = [];
    if (mode === 'skeletons') {
        if (hasMissingFile) reasons.push('Missing File');
        return reasons;
    }
    if (hasMissingFile)                      reasons.push('Missing File');
    if (hasZeroAmount)                       reasons.push('Zero Amount');
    if (hasUnknownVendor)                    reasons.push('Unknown Vendor');
    if (isMissingIdentity && hasMissingFile) reasons.push('Missing VAT & RegNo');
    if (isStuck)                             reasons.push(`Stuck in ${d.status}`);
    if (hasSameDates)                        reasons.push('dueDate = dateCreated (suspicious)');
    if (hasMissingDescription)               reasons.push('Missing Description');
    if (hasZeroTaxOnTaxableAmount && hasMissingFile) reasons.push('Zero tax but amount = subtotal');
    return reasons;
}

async function findBadStatuses() {
    const chunkSize = 10;
    const allDocs = [];
    for (let i = 0; i < PROBLEM_STATUSES.length; i += chunkSize) {
        const chunk = PROBLEM_STATUSES.slice(i, i + chunkSize);
        let q = db.collection('invoices').where('status', 'in', chunk);
        if (companyFilter) q = q.where('companyId', '==', companyFilter);
        const snap = await q.get();
        snap.forEach(doc => allDocs.push(doc));
    }
    const seen = new Set();
    return allDocs
        .filter(doc => { if (seen.has(doc.id)) return false; seen.add(doc.id); return true; })
        .map(doc => ({ id: doc.id, data: doc.data(), reason: `Bad status: ${doc.data().status}` }));
}

// ─── Get Original File ──────────────────────────────────────────────────────

/**
 * Download file from a URL (Firebase Storage signed URL).
 */
function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadUrl(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Retrieve the original file buffer for re-extraction.
 * Priority: 1) Firebase Storage via fileUrl  2) Storage via stagingId  3) null
 */
async function getOriginalFile(invoiceData) {
    // 1. Try fileUrl
    if (invoiceData.fileUrl && invoiceData.fileUrl !== 'BODY_TEXT_NO_ATTACHMENT') {
        try {
            const buffer = await downloadUrl(invoiceData.fileUrl);
            if (buffer && buffer.length > 100) return { buffer, mimeType: 'application/pdf' };
        } catch (err) {
            console.warn(`  [Repairman] fileUrl download failed: ${err.message}`);
        }
    }

    // 2. Try stagingId → raw_documents → storageUrl
    if (invoiceData.stagingId) {
        try {
            const staging = await getStagedDocument(invoiceData.stagingId);
            if (staging && staging.storageUrl) {
                const buffer = await downloadUrl(staging.storageUrl);
                if (buffer && buffer.length > 100) return { buffer, mimeType: 'application/pdf' };
            }
        } catch (err) {
            console.warn(`  [Repairman] Staging download failed: ${err.message}`);
        }
    }

    return null;
}

// ─── Core Repair Function ───────────────────────────────────────────────────

/**
 * Repair a single invoice by re-extracting from the original file.
 * UPDATES the record in place — never deletes.
 * If manuallyEdited=true, only fills empty fields.
 *
 * @param {string} invoiceId - Firestore document ID
 * @param {object} invoiceData - Current invoice data from Firestore
 * @returns {Promise<boolean>} true if repaired successfully
 */
async function repairInvoice(invoiceId, invoiceData) {
    console.log(`  [Repairman] Repairing ${invoiceId} (${invoiceData.vendorName || 'unknown'})...`);

    const file = await getOriginalFile(invoiceData);
    if (!file) {
        console.warn(`  [Repairman] No original file found for ${invoiceId}. Marking UNREPAIRABLE.`);
        await db.collection('invoices').doc(invoiceId).update({ status: 'UNREPAIRABLE' });
        return false;
    }

    // Lazy-load to avoid circular dependencies
    const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
    const { validateAndTeach } = require('./teacher_agent.cjs');

    // Re-extract with Scout
    let scoutResult;
    try {
        scoutResult = await processInvoiceWithDocAI(file.buffer, file.mimeType);
    } catch (err) {
        console.error(`  [Repairman] Scout extraction failed: ${err.message}`);
        return false;
    }

    if (!scoutResult || scoutResult.length === 0) {
        console.warn(`  [Repairman] Scout returned empty for ${invoiceId}.`);
        return false;
    }

    // Re-validate with Teacher
    const teacherResult = await validateAndTeach(scoutResult[0], invoiceData.companyId);

    // Build update object
    const newData = teacherResult.invoice;
    const updates = {};
    const isManual = invoiceData.manuallyEdited === true;

    const UPDATABLE_FIELDS = [
        'vendorName', 'invoiceId', 'description', 'amount', 'currency',
        'dateCreated', 'dueDate', 'supplierVat', 'supplierRegistration',
        'subtotalAmount', 'taxAmount',
    ];

    for (const field of UPDATABLE_FIELDS) {
        if (isManual) {
            // Manual edit: only fill empty fields, never overwrite
            if (isEmpty(invoiceData[field]) && !isEmpty(newData[field])) {
                updates[field] = newData[field];
            }
        } else {
            // Auto record: overwrite with fresh extraction
            if (!isEmpty(newData[field])) {
                updates[field] = newData[field];
            }
        }
    }

    // Always update metadata
    updates.repairedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.repairHistory = admin.firestore.FieldValue.arrayUnion({
        timestamp: new Date().toISOString(),
        corrections: teacherResult.corrections,
    });

    // Set status based on Teacher approval
    if (!isManual) {
        updates.status = teacherResult.approved ? 'Pending' : 'Needs Action';
    }

    // Teacher corrections metadata
    if (teacherResult.corrections.length > 0) {
        updates.teacherCorrections = teacherResult.corrections;
    }

    await db.collection('invoices').doc(invoiceId).update(updates);
    console.log(`  [Repairman] ✅ Updated ${invoiceId} with ${Object.keys(updates).length - 2} field(s).`);

    // Update staging
    if (invoiceData.stagingId) {
        await markRepairPending(invoiceData.stagingId);
        await incrementRepairAttempts(invoiceData.stagingId);
    }

    // Log repair
    await logRepair({
        repairedDocId: invoiceId,
        invoiceId:     invoiceData.invoiceId,
        vendorName:    invoiceData.vendorName,
        reason:        'Re-extracted from original file',
        stagingId:     invoiceData.stagingId,
        mode,
    });

    return true;
}

// ─── Infinite Loop Protection ────────────────────────────────────────────────

async function classifyByRepairAttempts(invoices) {
    const repairable = [];
    const unrepairable = [];
    for (const inv of invoices) {
        const attempts = await getRepairAttempts(inv.data.stagingId);
        if (attempts >= MAX_REPAIR_ATTEMPTS) {
            unrepairable.push({ ...inv, repairAttempts: attempts });
        } else {
            repairable.push(inv);
        }
    }
    return { repairable, unrepairable };
}

// ─── Report Printer ──────────────────────────────────────────────────────────

function printReport(invoices, label) {
    if (invoices.length === 0) return;
    console.log(`\n${label} (${invoices.length}):\n`);
    console.log(`${'Firestore ID'.padEnd(22)} ${'Vendor'.padEnd(30)} ${'Created'.padEnd(12)} Reason`);
    console.log('─'.repeat(90));
    for (const { id, data, reason } of invoices) {
        const ts = data.createdAt?.toDate ? data.createdAt.toDate() : null;
        const vendor = (data.vendorName || 'UNKNOWN').slice(0, 28).padEnd(30);
        const created = ts ? ts.toISOString().slice(0, 10).padEnd(12) : '—'.padEnd(12);
        console.log(`${id.slice(0, 21).padEnd(22)} ${vendor} ${created} ${reason}`);
    }
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

async function main() {
    console.log('─────────────────────────────────────────────────');
    console.log('РЕМОНТНИК (Repairman Agent) v3');
    console.log(`Mode: ${mode.toUpperCase()}`);
    console.log(`Date Range: ${sinceArg || 'all'} to ${untilArg || 'now'}`);
    if (companyFilter) console.log(`Company: ${companyFilter}`);
    console.log(dryRun ? 'DRY RUN (pass --fix to execute)' : 'LIVE EXECUTION');
    console.log('─────────────────────────────────────────────────\n');

    // ── Step 1: Find problems ────────────────────────────────────────────────
    console.log('Step 1: Scanning Firestore...');
    const allBad = await findBadInvoices();

    if (allBad.length === 0) {
        console.log('All invoices look healthy. No repairs needed.');
        process.exit(0);
    }

    console.log(`Found ${allBad.length} problematic record(s).`);

    // ── Step 2: Classify repairable vs unrepairable ──────────────────────────
    let repairable, unrepairable;

    if (mode === 'statuses') {
        repairable = allBad;
        unrepairable = [];
    } else {
        console.log('\nStep 2: Checking repair history...');
        ({ repairable, unrepairable } = await classifyByRepairAttempts(allBad));
    }

    printReport(repairable, 'REPAIRABLE');

    if (unrepairable.length > 0) {
        printReport(unrepairable, 'UNREPAIRABLE (max attempts reached — needs manual review)');
        if (!dryRun) {
            for (const inv of unrepairable) {
                try { await db.collection('invoices').doc(inv.id).update({ status: 'UNREPAIRABLE' }); } catch { /* ignore */ }
            }
            console.log(`  Marked ${unrepairable.length} record(s) as UNREPAIRABLE.`);
        }
    }

    if (repairable.length === 0) {
        console.log('\nNo repairable records.');
        process.exit(0);
    }

    // ── Step 3: Execute repairs ──────────────────────────────────────────────

    if (mode === 'statuses') {
        console.log(`\nStep 3: ${dryRun ? '[DRY RUN] Would reset' : 'Resetting'} ${repairable.length} record(s) to Pending...`);
        if (!dryRun) {
            const BATCH_SIZE = 400;
            let fixed = 0;
            for (let i = 0; i < repairable.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = repairable.slice(i, i + BATCH_SIZE);
                for (const { id, data } of chunk) {
                    batch.update(db.collection('invoices').doc(id), {
                        status: 'Pending',
                        previousStatus: data.status,
                        statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                await batch.commit();
                fixed += chunk.length;
            }
            for (const inv of repairable) {
                await logRepair({ repairedDocId: inv.id, invoiceId: inv.data.invoiceId, vendorName: inv.data.vendorName, reason: inv.reason, stagingId: inv.data.stagingId, mode: 'statuses' });
            }
            console.log(`Done. ${fixed} record(s) reset to Pending.`);
        }
        process.exit(0);
    }

    // Full / Skeletons mode: re-extract and UPDATE
    console.log(`\nStep 3: ${dryRun ? '[DRY RUN] Would repair' : 'Repairing'} ${repairable.length} record(s)...`);

    if (!dryRun) {
        let repaired = 0;
        let failed = 0;
        for (const inv of repairable) {
            try {
                const ok = await repairInvoice(inv.id, inv.data);
                if (ok) repaired++; else failed++;
            } catch (err) {
                console.error(`  [Repairman] Error repairing ${inv.id}: ${err.message}`);
                failed++;
            }
        }
        console.log(`\n  Repaired: ${repaired}, Failed: ${failed}`);
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    if (dryRun) {
        console.log(`Would repair ${repairable.length} record(s). Run with --fix to execute.`);
    } else {
        console.log('Repair complete. Records updated in place.');
    }

    process.exit(0);
}

// Run as CLI or as library
if (require.main === module) {
    main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { repairInvoice, findBadInvoices };
