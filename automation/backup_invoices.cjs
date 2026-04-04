#!/usr/bin/env node
/**
 * Backup & Restore invoices from Firestore → JSON file
 *
 * Usage:
 *   node backup_invoices.cjs                     # backup all invoices
 *   node backup_invoices.cjs --company <id>      # backup one company
 *   node backup_invoices.cjs --restore <file>    # restore from backup
 */

require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const { admin, db } = require('./core/firebase.cjs');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(n);

const companyFilter = getArg('--company');
const restoreFile = getArg('--restore');

async function backupInvoices() {
    if (!db) { console.error('Firebase not initialized'); process.exit(1); }

    console.log('[Backup] Loading all invoices...');

    let query = db.collection('invoices');
    if (companyFilter) {
        query = query.where('companyId', '==', companyFilter);
        console.log(`[Backup] Filtering by company: ${companyFilter}`);
    }

    const snap = await query.get();
    const records = [];

    for (const doc of snap.docs) {
        records.push({
            id: doc.id,
            data: doc.data(),
        });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup_invoices_${timestamp}.json`;
    const filepath = path.join(__dirname, filename);

    // Convert Firestore Timestamps to plain objects for JSON serialization
    const serialized = JSON.stringify(records, (key, value) => {
        if (value && value._seconds !== undefined && value._nanoseconds !== undefined) {
            return { _seconds: value._seconds, _nanoseconds: value._nanoseconds, __firestoreTimestamp: true };
        }
        return value;
    }, 2);

    fs.writeFileSync(filepath, serialized);
    console.log(`[Backup] ✅ Saved ${records.length} invoices → ${filename}`);
    console.log(`[Backup] To restore: node backup_invoices.cjs --restore ${filename}`);

    process.exit(0);
}

async function restoreInvoices() {
    if (!db) { console.error('Firebase not initialized'); process.exit(1); }

    const filepath = path.resolve(restoreFile);
    if (!fs.existsSync(filepath)) {
        console.error(`[Restore] File not found: ${filepath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(filepath, 'utf-8');
    const records = JSON.parse(raw, (key, value) => {
        if (value && value.__firestoreTimestamp) {
            return new admin.firestore.Timestamp(value._seconds, value._nanoseconds);
        }
        return value;
    });

    console.log(`[Restore] Loaded ${records.length} invoices from ${path.basename(filepath)}`);
    console.log('[Restore] Writing to Firestore in batches...');

    const BATCH_SIZE = 400;
    let restored = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = records.slice(i, i + BATCH_SIZE);

        for (const rec of chunk) {
            const ref = db.collection('invoices').doc(rec.id);
            batch.set(ref, rec.data);
        }

        await batch.commit();
        restored += chunk.length;
        console.log(`[Restore] ${restored}/${records.length} ...`);
    }

    console.log(`[Restore] ✅ Restored ${restored} invoices`);
    process.exit(0);
}

if (restoreFile) {
    restoreInvoices().catch(err => { console.error('[Restore] Fatal:', err); process.exit(1); });
} else {
    backupInvoices().catch(err => { console.error('[Backup] Fatal:', err); process.exit(1); });
}
