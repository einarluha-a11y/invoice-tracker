#!/usr/bin/env node
/**
 * fix_imap_whitespace.cjs — Trim whitespace from IMAP config fields in Firestore
 * One-shot utility: run once, then delete.
 */
require('dotenv').config({ path: __dirname + '/.env' });
const { db } = require('./core/firebase.cjs');

const FIELDS = ['imapHost', 'imapUser', 'imapPassword'];

(async () => {
    const snap = await db.collection('companies').get();
    let fixed = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const updates = {};

        for (const field of FIELDS) {
            const val = data[field];
            if (typeof val === 'string' && val !== val.trim()) {
                console.log(`[Fix] ${doc.id} (${data.name}): "${field}" had extra whitespace → "${val.trim()}"`);
                updates[field] = val.trim();
            }
        }

        if (Object.keys(updates).length > 0) {
            await doc.ref.update(updates);
            fixed++;
        }
    }

    if (fixed === 0) {
        console.log('✅  No whitespace found in any IMAP config fields.');
    } else {
        console.log(`\n✅  Fixed ${fixed} company record(s).`);
    }
    process.exit(0);
})();
