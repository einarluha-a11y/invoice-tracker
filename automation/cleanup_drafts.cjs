/**
 * SMART CLEANUP — Invoice Tracker
 *
 * For each NEEDS_REVIEW record without a fileUrl this script:
 *   1. Searches Firebase Storage for files uploaded within ±5 minutes of the record's createdAt
 *   2. If a file is found  → patches the record with the recovered fileUrl (no deletion)
 *   3. If no file found + record has real vendor+VAT+RegNo → keeps it (flags for manual review)
 *   4. If no file found + garbage data (filename-as-vendor / no VAT / no RegNo) → deletes
 *
 * Run once on the Mac where Firebase credentials are available:
 *   node automation/cleanup_drafts.cjs
 */

require('dotenv').config();
const admin = require('firebase-admin');

let serviceAccount;
try { serviceAccount = require('./google-credentials.json'); }
catch (e) { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null'); }

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    });
}

const db = admin.firestore();
const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

/** Returns true if the string looks like a filename rather than a company name */
const looksLikeFilename = (s) => /\.(pdf|jpg|jpeg|png|tiff?)$/i.test(s || '');

/** Returns true if the value is a real VAT / Reg No (not a placeholder) */
const isRealIdentifier = (s) => {
    if (!s) return false;
    const norm = String(s).trim().toLowerCase();
    return norm.length > 3 && norm !== 'not_found' && norm !== 'not found' &&
        norm !== 'unknown' && norm !== 'n/a' && !norm.includes('not_found_on_invoice');
};

/**
 * Try to find a Storage file uploaded within ±5 minutes of `createdAtMs`.
 * Returns a public download URL or null.
 */
async function findStorageFile(companyId, createdAtMs) {
    const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    const prefix = `invoices/${companyId}/`;

    try {
        const [files] = await bucket.getFiles({ prefix });
        for (const file of files) {
            const meta = file.metadata;
            const uploadedMs = new Date(meta.timeCreated).getTime();
            if (Math.abs(uploadedMs - createdAtMs) <= WINDOW_MS) {
                // Build download URL using the stored token if present
                const token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
                if (token) {
                    const encoded = encodeURIComponent(file.name);
                    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
                }
                // No token — generate a signed URL valid for 7 days as a fallback.
                // Wrapped in its own try/catch so a signing failure (e.g., missing IAM permission)
                // doesn't abort the entire Storage scan for this company.
                try {
                    const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
                    return signedUrl;
                } catch (signErr) {
                    console.warn(`[Cleanup] ⚠️  getSignedUrl failed for ${file.name}:`, signErr.message);
                    // Continue checking other files in the prefix
                }
            }
        }
    } catch (e) {
        console.warn(`[Cleanup] ⚠️  Storage scan failed for ${prefix}:`, e.message);
    }
    return null;
}

async function run() {
    console.log('[Cleanup] 🔍 Starting smart DRAFT/NEEDS_REVIEW cleanup...\n');

    const snap = await db.collection('invoices')
        .where('status', 'in', ['NEEDS_REVIEW', 'OOTEL'])
        .get();

    let recovered = 0;
    let kept = 0;
    let deleted = 0;

    for (const doc of snap.docs) {
        const data = doc.data();

        // Skip records that already have a file
        if (data.fileUrl) continue;

        const vendor = data.vendorName || '';
        const hasRealVendor = vendor && !looksLikeFilename(vendor) && vendor !== 'UNKNOWN VENDOR';
        const hasRealVat = isRealIdentifier(data.supplierVat);
        const hasRealReg = isRealIdentifier(data.supplierRegistration);
        const hasRealAmount = data.amount && Number(data.amount) !== 0;

        // Determine when this record was created
        const createdAt = data.safetyNetCapturedAt || data.createdAt;
        const createdAtMs = createdAt && createdAt.toMillis ? createdAt.toMillis() : Date.now();
        const cId = data.companyId || null;

        console.log(`[Cleanup] Checking: ${doc.id} | Vendor: ${vendor} | VAT: ${data.supplierVat} | Amount: ${data.amount}`);

        // Step 1: Try to recover file from Storage
        if (cId) {
            const recoveredUrl = await findStorageFile(cId, createdAtMs);
            if (recoveredUrl) {
                await doc.ref.update({
                    fileUrl: recoveredUrl,
                    validationWarnings: admin.firestore.FieldValue.arrayUnion(
                        `CLEANUP: fileUrl recovered from Storage by cleanup_drafts.cjs on ${new Date().toISOString()}`
                    )
                });
                console.log(`[Cleanup] ✅ RECOVERED file for ${doc.id} (${vendor})`);
                recovered++;
                continue;
            }
        }

        // Step 2: No file found — decide keep or delete
        const isGarbage = looksLikeFilename(vendor) || vendor === 'UNKNOWN VENDOR' ||
            !hasRealVendor || !hasRealAmount || (!hasRealVat && !hasRealReg);

        if (isGarbage) {
            console.log(`[Cleanup] 🗑️  DELETING garbage record: ${doc.id} (Vendor: ${vendor}, Amount: ${data.amount})`);
            await doc.ref.delete();
            deleted++;
        } else {
            // Valid data, no file — flag for manual review but keep
            await doc.ref.update({
                validationWarnings: admin.firestore.FieldValue.arrayUnion(
                    `CLEANUP WARNING: No file found in Storage within ±5min of creation. Manual review required (${new Date().toISOString()})`
                )
            });
            console.log(`[Cleanup] 📋 KEPT for manual review: ${doc.id} (${vendor}, VAT: ${data.supplierVat})`);
            kept++;
        }
    }

    console.log(`\n[Cleanup] ✅ Done.`);
    console.log(`   → Files recovered from Storage: ${recovered}`);
    console.log(`   → Records kept for manual review: ${kept}`);
    console.log(`   → Garbage records deleted: ${deleted}`);
    process.exit(0);
}

run().catch(e => {
    console.error('[Cleanup] ❌ Fatal error:', e.message);
    process.exit(1);
});
