/**
 * fix_all_statuses.cjs
 * 
 * One-time comprehensive fix: finds every invoice with a problematic
 * quarantine-related status and resets it to 'Pending'.
 * 
 * Targets: NEEDS_REVIEW, Needs Action, OOTEL, KARANTIIN,
 *          Карантин, Karantiin, ANOMALY_DETECTED, Error
 * 
 * Usage:
 *   node fix_all_statuses.cjs          — dry-run, shows counts only
 *   node fix_all_statuses.cjs --fix    — apply the reset
 */
require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--fix');

const PROBLEM_STATUSES = [
    'NEEDS_REVIEW', 'Needs Action', 'needs action',
    'OOTEL',        // Estonian "waiting" — was incorrectly shown as KARANTIIN
    'KARANTIIN', 'Karantine', 'Karantiin', 'Карантин',
    'ANOMALY_DETECTED', 'Error'
];

async function run() {
    console.log(`\n🔧 fix_all_statuses.cjs — ${DRY_RUN ? 'DRY RUN (add --fix to apply)' : '⚠️  WRITE MODE'}`);
    console.log(`   Targeting statuses: ${PROBLEM_STATUSES.join(', ')}\n`);

    // Firestore 'in' query max 10 values — split into chunks
    const chunkSize = 10;
    const allDocs = [];

    for (let i = 0; i < PROBLEM_STATUSES.length; i += chunkSize) {
        const chunk = PROBLEM_STATUSES.slice(i, i + chunkSize);
        const snap = await db.collection('invoices')
            .where('status', 'in', chunk)
            .get();
        snap.forEach(doc => allDocs.push(doc));
    }

    // Deduplicate by doc ID (shouldn't happen but be safe)
    const seen = new Set();
    const uniqueDocs = allDocs.filter(doc => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
    });

    if (uniqueDocs.length === 0) {
        console.log('✅  No problematic records found — database is clean!');
        process.exit(0);
    }

    // Group by company and status for reporting
    const byCompany = {};
    uniqueDocs.forEach(doc => {
        const d = doc.data();
        const key = d.companyId || '(no company)';
        if (!byCompany[key]) byCompany[key] = {};
        byCompany[key][d.status] = (byCompany[key][d.status] || 0) + 1;
    });

    console.log(`Found ${uniqueDocs.length} records to fix:\n`);
    Object.entries(byCompany).forEach(([company, statuses]) => {
        const total = Object.values(statuses).reduce((a, b) => a + b, 0);
        console.log(`  📁 ${company} (${total} total)`);
        Object.entries(statuses).forEach(([status, count]) => {
            console.log(`     "${status}": ${count}`);
        });
    });

    if (!DRY_RUN) {
        console.log('\n⏳ Resetting all to Pending...');
        const BATCH_SIZE = 400;
        let fixed = 0;

        for (let i = 0; i < uniqueDocs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = uniqueDocs.slice(i, i + BATCH_SIZE);
            chunk.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'Pending',
                    previousStatus: doc.data().status,
                    statusFixedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            fixed += chunk.length;
            console.log(`   Batch ${Math.ceil((i + 1) / BATCH_SIZE)}: fixed ${fixed}/${uniqueDocs.length}`);
        }

        console.log(`\n✅  Done! ${fixed} records reset to Pending.`);
        console.log('   Refresh your browser dashboard to see the changes.');
    } else {
        console.log(`\n👆 Run with --fix to apply (resets ${uniqueDocs.length} records to Pending).`);
    }

    process.exit(0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
