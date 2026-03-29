#!/usr/bin/env node
/**
 * backfill_staging.cjs — Create raw_documents entries for existing Firestore invoices
 *
 * Scans the `invoices` collection, finds records that have a fileUrl
 * (or originalFileUrl), and creates a corresponding raw_documents entry.
 * Useful after the staging layer is deployed: allows reprocess.cjs to work
 * on historical documents without going back to IMAP.
 *
 * Already-staged documents are automatically skipped (idempotent).
 *
 * Usage:
 *   node backfill_staging.cjs                         # dry-run, shows what would be created
 *   node backfill_staging.cjs --fix                   # write to raw_documents
 *   node backfill_staging.cjs --company <id> --fix    # one company only
 *   node backfill_staging.cjs --limit 200 --fix       # cap at N records
 *   node backfill_staging.cjs --since 2026-01-01 --fix
 */

const { admin, db } = require('./core/firebase.cjs');

const args     = process.argv.slice(2);
const getArg   = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (n) => args.includes(n);

const dryRun   = !hasFlag('--fix');
const company  = getArg('--company');
const limitArg = parseInt(getArg('--limit') || '2000', 10);
const since    = getArg('--since'); // ISO date string, e.g. 2026-01-01

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guessDocType(inv) {
    // Bank statements stored in invoices collection are rare but possible
    const name = (inv.vendorName || inv.description || '').toLowerCase();
    if (name.includes('выписка') || name.includes('väljavõte') || name.includes('bank statement')) return 'bank_statement';
    return 'invoice';
}

function guessFilename(inv) {
    const url = inv.fileUrl || inv.originalFileUrl || '';
    if (!url) return null;
    try {
        // Firebase Storage URL: .../o/ENCODED_PATH?token=...
        if (url.includes('/o/')) {
            const path = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
            return path.split('/').pop();
        }
        if (url.startsWith('gs://')) {
            return url.split('/').pop();
        }
    } catch (_) {}
    return null;
}

async function alreadyStaged(invoiceId) {
    // Check if a raw_documents entry already references this invoice in resultIds
    const snap = await db.collection('raw_documents')
        .where('resultIds', 'array-contains', invoiceId)
        .limit(1)
        .get();
    return !snap.empty;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    if (dryRun) {
        console.log('🔍  DRY RUN — pass --fix to actually write to raw_documents\n');
    }

    // Build query
    let q = db.collection('invoices').orderBy('createdAt', 'desc').limit(limitArg);
    if (company) q = q.where('companyId', '==', company);
    if (since)   q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(since)));

    console.log('Fetching invoices from Firestore...');
    const snap = await q.get();
    console.log(`Found ${snap.size} invoices to examine.\n`);

    let skippedNoUrl    = 0;
    let skippedStaged   = 0;
    let created         = 0;
    let errors          = 0;

    for (const doc of snap.docs) {
        const inv = doc.data();
        const id  = doc.id;

        // Must have a fileUrl
        const fileUrl = inv.fileUrl || inv.originalFileUrl || null;
        if (!fileUrl) {
            skippedNoUrl++;
            continue;
        }

        // Skip if already staged
        const staged = await alreadyStaged(id);
        if (staged) {
            skippedStaged++;
            continue;
        }

        const filename = guessFilename(inv) || `invoice-${id}.pdf`;
        const docType  = guessDocType(inv);

        // Determine receivedAt: use inv.createdAt or now
        const receivedAt = inv.createdAt || admin.firestore.FieldValue.serverTimestamp();

        console.log(`[${created + 1}] ${id.slice(0, 22)}… | ${docType.padEnd(14)} | ${(inv.vendorName || '').slice(0, 30).padEnd(30)} | ${filename.slice(0, 35)}`);

        if (!dryRun) {
            try {
                const ref = db.collection('raw_documents').doc();
                await ref.set({
                    type:             docType,
                    companyId:        inv.companyId || null,
                    source: {
                        subject:    `[backfill] ${inv.vendorName || ''}`,
                        from:       '',
                        date:       inv.invoiceDate || '',
                        filename,
                        messageUid: null,
                    },
                    storageUrl:       fileUrl,
                    rawText:          null, // original raw text not available for historical records
                    receivedAt,
                    processedAt:      receivedAt, // already processed
                    processingStatus: 'success',
                    processingError:  null,
                    resultIds:        [id],
                    backfilled:       true, // marker so you can distinguish from live records
                });
            } catch (err) {
                console.error(`   ❌ Failed to create staging entry: ${err.message}`);
                errors++;
                continue;
            }
        }

        created++;
    }

    console.log('\n─────────────────────────────────────────────────');
    console.log(`Examined:           ${snap.size}`);
    console.log(`Skipped (no URL):   ${skippedNoUrl}`);
    console.log(`Skipped (staged):   ${skippedStaged}`);
    console.log(`${dryRun ? 'Would create' : 'Created'}:         ${created}`);
    if (errors) console.log(`Errors:             ${errors}`);
    if (dryRun) {
        console.log('\nRun with --fix to apply changes.');
    } else {
        console.log('\n✅  Backfill complete.');
        console.log('You can now use:  node reprocess.cjs --list');
    }

    process.exit(0);
})();
