/**
 * restore_file_urls.cjs
 * 
 * Finds invoices that lost their fileUrl and attempts to restore it from:
 *   1. originalFileUrl field (old webhook pipeline records)
 *   2. Reports those that cannot be auto-restored (need manual re-upload)
 * 
 * Safe to run multiple times — only touches records with missing/null fileUrl.
 * 
 * Usage:
 *   node restore_file_urls.cjs              — scan all companies, ask before writing
 *   node restore_file_urls.cjs --fix        — actually apply the fixes
 *   node restore_file_urls.cjs --company <id> --fix  — fix a single company
 */
require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--fix');
const TARGET_COMPANY = (() => {
    const idx = process.argv.indexOf('--company');
    return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function run() {
    console.log(`\n🔍 restore_file_urls.cjs — ${DRY_RUN ? 'DRY RUN (add --fix to apply)' : '⚠️  WRITE MODE'}\n`);

    let q = db.collection('invoices');
    if (TARGET_COMPANY) {
        console.log(`   Targeting company: ${TARGET_COMPANY}`);
        q = q.where('companyId', '==', TARGET_COMPANY);
    }

    const snap = await q.get();
    console.log(`   Total invoices scanned: ${snap.size}\n`);

    const canRestore = [];    // has originalFileUrl, can be auto-fixed
    const cannotRestore = []; // neither field present — manual action required
    let alreadyOk = 0;

    snap.forEach(doc => {
        const d = doc.data();
        if (d.fileUrl) {
            alreadyOk++;
            return;
        }
        // fileUrl is missing/null
        if (d.originalFileUrl) {
            canRestore.push({ id: doc.id, vendor: d.vendorName, company: d.companyId, url: d.originalFileUrl });
        } else {
            cannotRestore.push({ id: doc.id, vendor: d.vendorName, company: d.companyId, status: d.status });
        }
    });

    console.log(`✅  Records with fileUrl OK:         ${alreadyOk}`);
    console.log(`🔧  Records restorable (originalFileUrl): ${canRestore.length}`);
    console.log(`❌  Records with NO file at all:     ${cannotRestore.length}`);

    if (canRestore.length > 0) {
        console.log('\n--- Restorable records ---');
        canRestore.forEach(r => console.log(`  [${r.company}] ${r.vendor || r.id}  →  ${r.url.substring(0, 80)}...`));

        if (!DRY_RUN) {
            console.log('\n⏳ Restoring fileUrl from originalFileUrl...');
            const batch = db.batch();
            canRestore.forEach(r => {
                batch.update(db.collection('invoices').doc(r.id), {
                    fileUrl: r.url,
                    restoredAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log(`✅  Restored ${canRestore.length} records.`);
        }
    }

    if (cannotRestore.length > 0) {
        console.log('\n--- Records with no file URL (need manual re-upload) ---');
        cannotRestore.forEach(r => console.log(`  [${r.company}] ${r.vendor || r.id}  status=${r.status}`));
    }

    if (DRY_RUN && (canRestore.length > 0)) {
        console.log('\n👆 Run with --fix to apply the restore.');
    }

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
