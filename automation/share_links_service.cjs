/**
 * Share Links Service — viral loop (sprint 5).
 *
 * Generates public upload tokens that a user can send to their suppliers
 * so the supplier can drop a PDF invoice directly into the user's
 * Invoice Tracker account without having an account themselves. Each
 * successful upload exposes the "Powered by Invoice Tracker" CTA,
 * seeding sign-ups organically.
 *
 * Security model
 *
 * - Token creation requires an authenticated user (Firebase ID token).
 *   The user owns the link and decides which company it's scoped to.
 * - Token upload is PUBLIC. The only trust boundary is the token
 *   itself — 32 hex chars, cryptographically random, single-use-style.
 * - Rate limits per IP + per token prevent abuse.
 * - Each token has:
 *     - expiresAt: 30 days default (configurable)
 *     - maxUploads: 10 default (kills compromised tokens quickly)
 *     - uploadsCount: incremented atomically on every successful upload
 * - Uploaded files go through the SAME invoice_processor pipeline as
 *   IMAP-ingested invoices — self-invoice guard, duplicate detection,
 *   billing charge (once sprint 2b is enforced) all apply.
 * - The supplier's IP and a short fingerprint are stored on the upload
 *   event for audit, never exposed to the UI.
 *
 * Firestore shape
 *
 *   share_links/{token} = {
 *     token: string,             // 32 hex chars
 *     ownerUid: string,          // who created it
 *     companyId: string | null,  // scoping — invoices land here
 *     accountId: string | null,
 *     createdAt: number,
 *     expiresAt: number,
 *     maxUploads: number,        // hard cap on successful uploads
 *     uploadsCount: number,      // incremented atomically
 *     revoked: boolean,          // owner can kill the link
 *     label: string,             // human label, e.g. "Vendor X"
 *   }
 *
 *   share_uploads/{autoId} = {
 *     token: string,             // parent link
 *     companyId: string | null,
 *     fileName: string,
 *     fileSize: number,
 *     contentType: string,
 *     uploaderIp: string,        // audit only
 *     at: ServerTimestamp,
 *     invoiceDocId: string | null, // set if invoice_processor created one
 *   }
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const crypto = require('crypto');
const { admin, db, bucket } = require('./core/firebase.cjs');

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_MAX_UPLOADS = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB — Zapier-style cap
const ALLOWED_CONTENT_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
]);

/**
 * Validate a file by its magic bytes (first few bytes of the buffer)
 * rather than trusting the client-supplied Content-Type header. Prevents
 * an attacker from uploading arbitrary binaries (executables, polyglot
 * JS, corrupted JPEGs with exploit payloads) by claiming the file is a
 * PDF. Returns the detected type or null if nothing matches.
 *
 * Magic signatures:
 *   PDF:  %PDF           (0x25 0x50 0x44 0x46)
 *   JPEG: 0xFF 0xD8 0xFF (with variant 0xE0 or 0xE1 or 0xDB etc)
 *   PNG:  0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 *
 * The check is minimal — we don't validate the rest of the file
 * structure, just the leading bytes. A well-crafted polyglot could
 * still sneak through, but it's a large jump in attacker effort
 * compared to "lie about the Content-Type header".
 */
function detectFileType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
    const b = buffer;
    // PDF: %PDF
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
        return 'application/pdf';
    }
    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
        return 'image/jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
        b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
    ) {
        return 'image/png';
    }
    return null;
}

// ─── Create a new share link ─────────────────────────────────────────────────
/**
 * Generate a cryptographically random token and persist the link.
 *
 * @param {object} opts
 * @param {string} opts.ownerUid      — Firebase uid of the creator
 * @param {string} opts.companyId     — where uploaded invoices will land
 * @param {string} [opts.accountId]   — optional account scope
 * @param {string} [opts.label]       — human-readable label ("Acme Supplies")
 * @param {number} [opts.ttlDays]     — override default 30-day lifetime
 * @param {number} [opts.maxUploads]  — override default 10 upload cap
 * @returns {Promise<{token: string, expiresAt: number, url: string}>}
 */
async function createShareLink({
    ownerUid,
    companyId,
    accountId = null,
    label = '',
    ttlDays = DEFAULT_TTL_DAYS,
    maxUploads = DEFAULT_MAX_UPLOADS,
}) {
    if (!ownerUid) throw new Error('createShareLink: ownerUid required');
    if (!db) throw new Error('createShareLink: Firestore not initialized');

    const token = crypto.randomBytes(16).toString('hex'); // 32 chars
    const now = Date.now();
    const expiresAt = now + ttlDays * 86400_000;

    await db.collection('share_links').doc(token).create({
        token,
        ownerUid,
        companyId: companyId || null,
        accountId: accountId || null,
        label: String(label || '').slice(0, 120),
        createdAt: now,
        expiresAt,
        maxUploads: Math.max(1, Math.min(100, Number(maxUploads) || DEFAULT_MAX_UPLOADS)),
        uploadsCount: 0,
        revoked: false,
    });

    const baseUrl = process.env.PUBLIC_APP_URL || 'https://invoice-tracker-backend-production.up.railway.app';
    return {
        token,
        expiresAt,
        url: `${baseUrl}/share/${token}`,
    };
}

// ─── Validate a token at upload time ─────────────────────────────────────────
/**
 * Fetch the link doc and validate:
 *   - exists
 *   - not revoked
 *   - not expired
 *   - not over the maxUploads cap
 *
 * Returns the link data on success or throws a user-friendly error.
 */
async function validateToken(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
        const err = new Error('Invalid link');
        err.status = 400;
        throw err;
    }
    if (!db) {
        const err = new Error('Service unavailable');
        err.status = 503;
        throw err;
    }
    const ref = db.collection('share_links').doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
        const err = new Error('Link not found');
        err.status = 404;
        throw err;
    }
    const link = snap.data();
    if (link.revoked) {
        const err = new Error('Link revoked');
        err.status = 410;
        throw err;
    }
    if (link.expiresAt && Date.now() > link.expiresAt) {
        const err = new Error('Link expired');
        err.status = 410;
        throw err;
    }
    if (link.uploadsCount >= link.maxUploads) {
        const err = new Error('Upload limit reached for this link');
        err.status = 429;
        throw err;
    }
    return { ref, link };
}

// ─── Handle a public upload ──────────────────────────────────────────────────
/**
 * Upload a file through a share link. File should be a Buffer.
 *
 * Flow:
 *   1. Validate token + link state
 *   2. Validate file metadata (size, content type)
 *   3. Upload to Firebase Storage under a token-scoped path
 *   4. Run it through processInvoiceWithDocAI (Scout) + writeToFirestore
 *   5. Atomically bump uploadsCount
 *   6. Log a share_uploads audit row
 *
 * Returns { success: true, invoiceCount, remainingUploads }.
 */
async function handleShareUpload({ token, fileBuffer, fileName, contentType, uploaderIp }) {
    const { ref: linkRef, link } = await validateToken(token);

    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
        const err = new Error('File is required');
        err.status = 400;
        throw err;
    }
    if (fileBuffer.length > MAX_FILE_SIZE) {
        const err = new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
        err.status = 413;
        throw err;
    }
    // Sanity-check the client-supplied Content-Type first (cheap early
    // rejection), but the authoritative check is magic-byte detection
    // below. Trusting only the header lets an attacker upload arbitrary
    // bytes by lying about Content-Type.
    const claimedMime = (contentType || 'application/pdf').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_CONTENT_TYPES.has(claimedMime)) {
        const err = new Error(`Content type not allowed: ${claimedMime}`);
        err.status = 415;
        throw err;
    }
    const detectedMime = detectFileType(fileBuffer);
    if (!detectedMime) {
        const err = new Error('File is not a recognised PDF, JPEG, or PNG');
        err.status = 415;
        throw err;
    }
    // Final mime is what the file ACTUALLY is, not what the uploader
    // claimed. jpg/jpeg collapsed to image/jpeg. This is what we write
    // to Storage metadata and pass to the extraction pipeline.
    const mime = detectedMime;
    if (claimedMime !== mime && !(claimedMime === 'image/jpg' && mime === 'image/jpeg')) {
        console.warn(
            `[ShareLink] mime mismatch token=${token.slice(0, 8)}… ` +
            `claimed=${claimedMime} detected=${mime}`
        );
    }

    // Store in Storage under a predictable path so orphan_cleanup can
    // pair it with the resulting invoice.
    const cleanName = String(fileName || 'invoice.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '').slice(0, 80) || 'invoice.pdf';
    const storagePath = `share-uploads/${link.companyId || 'UNKNOWN'}/${token}/${Date.now()}_${cleanName}`;
    const uploadToken = crypto.randomUUID();

    if (!bucket) {
        const err = new Error('Storage not available');
        err.status = 503;
        throw err;
    }
    await bucket.file(storagePath).save(fileBuffer, {
        metadata: {
            contentType: mime,
            metadata: { firebaseStorageDownloadTokens: uploadToken },
        },
    });
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${uploadToken}`;

    // Run the same pipeline as IMAP-ingested invoices. Lazy-require to
    // avoid pulling in the whole pipeline when share links aren't used.
    const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
    const { writeToFirestore } = require('./invoice_processor.cjs');

    const extracted = await processInvoiceWithDocAI(fileBuffer, mime);
    if (!extracted || extracted.length === 0) {
        // Still count the upload attempt so a bad file can't be retried forever
        await linkRef.update({ uploadsCount: admin.firestore.FieldValue.increment(1) });
        const err = new Error('Could not extract invoice data from file');
        err.status = 422;
        throw err;
    }

    // Stamp each extracted record with the link's companyId so it lands
    // in the owner's bucket even if Scout guessed a different one.
    for (const inv of extracted) {
        inv.companyId = link.companyId || inv.companyId || null;
        inv.fileUrl = fileUrl;
        inv.sourceChannel = 'share_link';
        inv.shareToken = token;
    }

    await writeToFirestore(extracted);

    // Atomic counter bump + audit row
    await linkRef.update({
        uploadsCount: admin.firestore.FieldValue.increment(1),
        lastUploadAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    try {
        await db.collection('share_uploads').add({
            token,
            companyId: link.companyId || null,
            fileName: cleanName,
            fileSize: fileBuffer.length,
            contentType: mime,
            uploaderIp: String(uploaderIp || '').slice(0, 64),
            at: admin.firestore.FieldValue.serverTimestamp(),
            invoiceCount: extracted.length,
        });
    } catch (auditErr) {
        console.warn(`[ShareLink] audit log failed: ${auditErr.message}`);
    }

    return {
        success: true,
        invoiceCount: extracted.length,
        remainingUploads: Math.max(0, link.maxUploads - (link.uploadsCount + 1)),
    };
}

// ─── Revoke a link ───────────────────────────────────────────────────────────
async function revokeShareLink({ token, ownerUid }) {
    if (!db) throw new Error('Service unavailable');
    const ref = db.collection('share_links').doc(token);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('Link not found');
    if (snap.data().ownerUid !== ownerUid) {
        const err = new Error('Not your link');
        err.status = 403;
        throw err;
    }
    await ref.update({ revoked: true, revokedAt: Date.now() });
    return { success: true };
}

// ─── List links for a user ───────────────────────────────────────────────────
async function listShareLinks({ ownerUid, companyId = null }) {
    if (!db) throw new Error('Service unavailable');
    let q = db.collection('share_links').where('ownerUid', '==', ownerUid);
    if (companyId) q = q.where('companyId', '==', companyId);
    const snap = await q.limit(50).get();
    return snap.docs.map((d) => d.data());
}

module.exports = {
    createShareLink,
    validateToken,
    handleShareUpload,
    revokeShareLink,
    listShareLinks,
    DEFAULT_TTL_DAYS,
    DEFAULT_MAX_UPLOADS,
    MAX_FILE_SIZE,
    ALLOWED_CONTENT_TYPES,
    // Exposed for tests — pure function, safe to call without Firestore
    detectFileType,
};
