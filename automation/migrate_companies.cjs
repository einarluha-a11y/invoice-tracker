#!/usr/bin/env node
/**
 * migrate_companies.cjs — переносит глобальные companies/ в accounts/{id}/companies/
 *
 * Usage:
 *   node migrate_companies.cjs --account <accountId>          # dry-run
 *   node migrate_companies.cjs --account <accountId> --save   # live
 *
 * What it does:
 *   1. Reads all documents from global 'companies' collection
 *   2. Copies them to accounts/{accountId}/companies/ (preserving doc IDs)
 *   3. Does NOT delete the originals — safe to re-run
 *
 * After migration, verify the UI works, then manually delete the global companies.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.pipeline') });
const { db } = require('./core/firebase.cjs');

const args      = process.argv.slice(2);
const getArg    = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const save      = args.includes('--save');
const accountId = getArg('--account');

if (!accountId) {
    console.error('Usage: node migrate_companies.cjs --account <accountId> [--save]');
    process.exit(1);
}

async function migrate() {
    console.log(`[migrate_companies] account=${accountId} save=${save}`);

    const snap = await db.collection('companies').get();
    if (snap.empty) { console.log('No global companies found.'); return; }

    console.log(`Found ${snap.size} companies to migrate.`);
    let done = 0;
    let skipped = 0;

    for (const docSnap of snap.docs) {
        const targetRef = db
            .collection('accounts').doc(accountId)
            .collection('companies').doc(docSnap.id);

        const existing = await targetRef.get();
        if (existing.exists) {
            console.log(`  [skip] ${docSnap.id} — already exists in target`);
            skipped++;
            continue;
        }

        if (save) {
            await targetRef.set({ ...docSnap.data(), _migratedFrom: 'global', _migratedAt: new Date().toISOString() });
            console.log(`  [copy] ${docSnap.id} — ${docSnap.data().name || '(no name)'}`);
        } else {
            console.log(`  [dry]  ${docSnap.id} — ${docSnap.data().name || '(no name)'}`);
        }
        done++;
    }

    console.log(`\nDone. ${save ? 'Copied' : 'Would copy'}: ${done}, skipped: ${skipped}`);
    if (!save) console.log('Run with --save to apply.');
}

migrate().catch(err => { console.error(err); process.exit(1); });
