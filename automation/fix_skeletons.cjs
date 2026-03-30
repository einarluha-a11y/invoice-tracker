#!/usr/bin/env node
/**
 * fix_skeletons.cjs — Find and remove skeleton invoice records (missing fileUrl)
 *
 * A "skeleton" is a Firestore invoice record that was saved WITHOUT a fileUrl.
 * These arise when the email body-text parser creates partial records that bypass
 * proper PDF upload. After deploying the Completeness Gate fix in accountant_agent.cjs,
 * no new skeletons will be created — but existing ones must be cleaned up manually.
 *
 * Usage:
 *   node fix_skeletons.cjs                          # dry-run — show all skeletons
 *   node fix_skeletons.cjs --fix                    # delete skeleton records
 *   node fix_skeletons.cjs --company <id>           # filter by company
 *   node fix_skeletons.cjs --since 2026-03-01       # filter by date
 *   node fix_skeletons.cjs --fix --company <id>     # delete for one company only
 *
 * RECOVERY after deletion:
 *   Option A (preferred): Forward the original PDF to the invoices inbox — it will be
 *             re-processed with the new Completeness Gate active.
 *   Option B: If the email is still in IMAP, run:
 *             node reprocess.cjs (once raw_documents is populated after next git push)
 */

const { admin, db } = require('./core/firebase.cjs');

const args    = process.argv.slice(2);
const getArg  = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(n);

const dryRun  = !hasFlag('--fix');
const company = getArg('--company');
const since   = getArg('--since');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSkeleton(data) {
    // A skeleton has no fileUrl AND no originalFileUrl
    const hasFile = !!(data.fileUrl || data.originalFileUrl);
    if (hasFile) return false;

    // Also consider records where fileUrl is explicitly 'BODY_TEXT_NO_ATTACHMENT'
    // but failed the Completeness Gate — those have status 'Error' and no real file
    if (data.fileUrl === 'BODY_TEXT_NO_ATTACHMENT') return true;

    return true; // no file = skeleton
}

function fmtDate(ts) {
    if (!ts) return '—';
    if (ts._seconds) return new Date(ts._seconds * 1000).toISOString().slice(0, 10);
    return String(ts).slice(0, 10);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    if (dryRun) {
        console.log('🔍  DRY RUN — pass --fix to actually delete skeleton records\n');
    } else {
        console.log('⚠️   LIVE MODE — skeleton records will be permanently deleted\n');
    }

    let q = db.collection('invoices').orderBy('createdAt', 'desc').limit(2000);
    if (company) q = q.where('companyId', '==', company);
    if (since)   q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(since)));

    console.log('Scanning invoices collection...');
    const snap = await q.get();
    console.log(`Examined: ${snap.size} records\n`);

    const skeletons = [];

    for (const doc of snap.docs) {
        const d = doc.data();
        if (isSkeleton(d)) {
            skeletons.push({ id: doc.id, data: d });
        }
    }

    if (skeletons.length === 0) {
        console.log('✅  No skeleton records found. Dashboard is clean.');
        process.exit(0);
    }

    console.log(`Found ${skeletons.length} skeleton record(s):\n`);
    console.log(`${'Firestore ID'.padEnd(22)} ${'Vendor'.padEnd(30)} ${'InvoiceID'.padEnd(22)} ${'Amount'.padEnd(10)} ${'Status'.padEnd(14)} Created`);
    console.log('─'.repeat(115));

    for (const { id, data: d } of skeletons) {
        const vendor   = (d.vendorName || '—').slice(0, 28).padEnd(30);
        const invId    = (d.invoiceId  || '—').slice(0, 20).padEnd(22);
        const amount   = String(d.amount ?? '—').padEnd(10);
        const status   = (d.status     || '—').padEnd(14);
        const created  = fmtDate(d.createdAt);
        console.log(`${id.slice(0, 21).padEnd(22)} ${vendor} ${invId} ${amount} ${status} ${created}`);
    }

    console.log('');

    if (dryRun) {
        console.log(`Would delete: ${skeletons.length} records.`);
        console.log('\nRun with --fix to delete them.');
        console.log('\nRECOVERY: After deletion, forward the original PDFs to the invoices email inbox');
        console.log('          so they are re-processed with the Completeness Gate active.');
        process.exit(0);
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    console.log(`Deleting ${skeletons.length} skeleton records...`);
    let deleted = 0;
    let failed  = 0;

    // Batch deletes (max 500 per batch)
    const BATCH_SIZE = 400;
    for (let i = 0; i < skeletons.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = skeletons.slice(i, i + BATCH_SIZE);
        for (const { id } of chunk) {
            batch.delete(db.collection('invoices').doc(id));
        }
        try {
            await batch.commit();
            deleted += chunk.length;
            console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} records`);
        } catch (err) {
            console.error(`  ❌ Batch failed: ${err.message}`);
            failed += chunk.length;
        }
    }

    console.log(`\n─────────────────────────────────────────────────`);
    console.log(`✅  Deleted: ${deleted}`);
    if (failed) console.log(`❌  Failed:  ${failed}`);
    console.log('\nRECOVERY: Forward the original PDFs to the invoices email inbox.');
    console.log('          The re-processed records will now include all data + file.');

    process.exit(0);
})();
