/**
 * cleanup_pipeline_exceptions.cjs
 *
 * Deletes "UNKNOWN (pipeline exception)" NEEDS_REVIEW records created by the Safety Net
 * when the 3-day IMAP sweep caused API rate-limit exceptions on 30.03.2026.
 *
 * These records have:
 *   - vendorName = "UNKNOWN (pipeline exception)"
 *   - status = "NEEDS_REVIEW"
 *   - invoiceId starts with "ATTACHMENT-"
 *   - amount = null or 0
 *
 * Usage:
 *   node cleanup_pipeline_exceptions.cjs           # dry run — shows what would be deleted
 *   node cleanup_pipeline_exceptions.cjs --fix      # actually deletes
 *   node cleanup_pipeline_exceptions.cjs --fix --company <companyId>
 */

const { db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--fix');
const COMPANY_FILTER = (() => {
    const idx = process.argv.indexOf('--company');
    return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function main() {
    console.log(`\n=== Pipeline Exception Cleanup ===`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (add --fix to delete)' : '⚠️  LIVE DELETE'}`);
    if (COMPANY_FILTER) console.log(`Company filter: ${COMPANY_FILTER}`);
    console.log('');

    // Query NEEDS_REVIEW records with UNKNOWN pipeline exception vendor
    let query = db.collection('invoices')
        .where('vendorName', '==', 'UNKNOWN (pipeline exception)')
        .where('status', '==', 'NEEDS_REVIEW');

    if (COMPANY_FILTER) {
        query = query.where('companyId', '==', COMPANY_FILTER);
    }

    const snap = await query.get();
    console.log(`Found ${snap.size} UNKNOWN pipeline exception record(s)`);

    if (snap.size === 0) {
        console.log('✅ Nothing to clean up.');
        process.exit(0);
    }

    // Show all found records
    snap.forEach(doc => {
        const d = doc.data();
        console.log(`  - ${doc.id} | invoiceId: ${d.invoiceId} | company: ${d.companyId} | fileUrl: ${d.fileUrl ? 'YES' : 'NO'}`);
    });

    if (DRY_RUN) {
        console.log(`\n[DRY RUN] Would delete ${snap.size} records. Run with --fix to apply.`);
        process.exit(0);
    }

    // Delete in batches of 400
    const BATCH_SIZE = 400;
    const docs = snap.docs;
    let deleted = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + BATCH_SIZE);
        for (const doc of chunk) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        deleted += chunk.length;
        console.log(`  ✅ Deleted batch ${Math.ceil((i + 1) / BATCH_SIZE)}: ${chunk.length} records (${deleted}/${docs.length} total)`);
    }

    console.log(`\n✅ Done. Deleted ${deleted} pipeline exception records.`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
