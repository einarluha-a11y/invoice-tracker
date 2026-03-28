/**
 * reset_needs_action.cjs
 * 
 * Quick-reset for invoices stuck in 'Needs Action' status due to old
 * aggressive quarantine rules (pre-fix). Sets them back to 'Pending' so
 * they appear normal in the UI, then quarantine_rewriter can re-evaluate
 * them properly when you're ready.
 * 
 * Usage:
 *   node reset_needs_action.cjs              — dry-run, shows what would change
 *   node reset_needs_action.cjs --fix        — apply the reset
 *   node reset_needs_action.cjs --company <id> --fix
 */
require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--fix');
const TARGET_COMPANY = (() => {
    const idx = process.argv.indexOf('--company');
    return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function run() {
    console.log(`\n⚡ reset_needs_action.cjs — ${DRY_RUN ? 'DRY RUN (add --fix to apply)' : '⚠️  WRITE MODE'}\n`);

    let q = db.collection('invoices').where('status', '==', 'Needs Action');
    if (TARGET_COMPANY) {
        // Firestore doesn't support multiple where clauses on different fields without composite index,
        // so filter by company client-side when combined with status
        console.log(`   Will filter for company: ${TARGET_COMPANY}`);
    }

    const snap = await q.get();
    const records = [];
    snap.forEach(doc => {
        const d = doc.data();
        if (!TARGET_COMPANY || d.companyId === TARGET_COMPANY) {
            records.push({ id: doc.id, vendor: d.vendorName, company: d.companyId, warnings: (d.validationWarnings || []).slice(0, 2) });
        }
    });

    console.log(`Found ${records.length} 'Needs Action' records${TARGET_COMPANY ? ` for company ${TARGET_COMPANY}` : ' (all companies)'}.\n`);

    if (records.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    records.forEach(r => {
        const criticals = r.warnings.filter(w => w.startsWith('CRITICAL:')).length;
        console.log(`  [${r.company}] ${r.vendor || r.id}${criticals > 0 ? ` ⚠️  (${criticals} CRITICAL warning(s))` : ''}`);
    });

    if (!DRY_RUN) {
        console.log('\n⏳ Resetting to Pending...');
        // Batch writes (max 500 per batch)
        const chunkSize = 400;
        for (let i = 0; i < records.length; i += chunkSize) {
            const chunk = records.slice(i, i + chunkSize);
            const batch = db.batch();
            chunk.forEach(r => {
                batch.update(db.collection('invoices').doc(r.id), {
                    status: 'Pending',
                    resetAt: admin.firestore.FieldValue.serverTimestamp(),
                    resetNote: 'Manually reset from Needs Action — pre-fix false positive'
                });
            });
            await batch.commit();
        }
        console.log(`✅  Reset ${records.length} records to 'Pending'.`);
        console.log('\n💡 Tip: run quarantine_rewriter.cjs to re-evaluate with updated rules.');
    } else {
        console.log('\n👆 Run with --fix to apply the reset.');
    }

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
