#!/usr/bin/env node
/**
 * Cleanup duplicate bank_transactions in Firestore.
 *
 * Groups all transactions by the deterministic key (buildTxKey from core/bank_dedup.cjs).
 * In each group with >1 records, keeps one representative:
 *   1. Prefer record with matchedInvoiceId !== null (has reconciliation link)
 *   2. Otherwise prefer oldest by savedAt (first written is canonical)
 * Deletes all other records in the group.
 *
 * Usage:
 *   node cleanup_bank_tx_duplicates.cjs          # dry-run (default)
 *   node cleanup_bank_tx_duplicates.cjs --fix     # actually delete
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { db } = require('./core/firebase.cjs');
const { buildTxKey } = require('./core/bank_dedup.cjs');

const FIX = process.argv.includes('--fix');

(async () => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Bank transactions duplicate cleanup ${FIX ? '(LIVE)' : '(DRY RUN)'}`);
    console.log(`${'═'.repeat(60)}\n`);

    const snap = await db.collection('bank_transactions').get();
    console.log(`Total transactions: ${snap.size}`);

    // Group by deterministic key
    const groups = new Map();
    for (const doc of snap.docs) {
        const data = doc.data();
        const key = buildTxKey({
            companyId: data.companyId,
            date: data.date,
            amount: data.amount,
            reference: data.reference,
            counterparty: data.counterparty,
        });
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id: doc.id, data, savedSec: data.savedAt?._seconds || 0 });
    }

    const dupeGroups = [...groups.values()].filter(g => g.length > 1);
    console.log(`Unique keys: ${groups.size}`);
    console.log(`Duplicate groups (>1 records): ${dupeGroups.length}`);

    let toDelete = 0;
    let deleted = 0;

    for (const group of dupeGroups) {
        // Pick survivor: prefer record with matchedInvoiceId, otherwise oldest
        const withMatch = group.filter(r => r.data.matchedInvoiceId);
        let survivor;
        if (withMatch.length > 0) {
            // Among those with match, keep the oldest
            survivor = withMatch.sort((a, b) => a.savedSec - b.savedSec)[0];
        } else {
            // Keep the oldest overall
            survivor = group.sort((a, b) => a.savedSec - b.savedSec)[0];
        }

        const victims = group.filter(r => r.id !== survivor.id);
        toDelete += victims.length;

        const first = survivor.data;
        console.log(
            `\nGroup: ${first.reference || 'no-ref'} | ${first.amount} | ${first.date} | ${first.counterparty || 'no-cp'}`
        );
        console.log(`  Keep:   ${survivor.id}${survivor.data.matchedInvoiceId ? ' (matched)' : ''}`);
        for (const v of victims) {
            console.log(`  Delete: ${v.id}`);
            if (FIX) {
                try {
                    await db.collection('bank_transactions').doc(v.id).delete();
                    deleted++;
                } catch (err) {
                    console.error(`    ERROR deleting ${v.id}: ${err.message}`);
                }
            }
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Duplicates to delete: ${toDelete}`);
    if (FIX) {
        console.log(`Actually deleted: ${deleted}`);
    } else {
        console.log(`DRY RUN — run with --fix to execute`);
    }
    console.log(`${'═'.repeat(60)}\n`);
    process.exit(0);
})();
