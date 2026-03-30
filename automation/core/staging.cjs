/**
 * core/staging.cjs — Raw Document Staging Layer
 *
 * Every document that arrives via IMAP (invoice, bank statement, image)
 * is saved here BEFORE any AI processing. This allows re-processing any
 * document at any time without going back to the email inbox.
 *
 * Firestore collection: raw_documents
 * Firebase Storage:     already handled by imap_daemon (fileUrl)
 *
 * Document schema:
 *   type:             'invoice' | 'bank_statement' | 'image_invoice' | 'unknown'
 *   companyId:        string
 *   source:           { subject, from, date, filename, messageUid }
 *   storageUrl:       string  — Firebase Storage download URL (set after upload)
 *   rawText:          string  — PDF/text content extracted before AI
 *   receivedAt:       Timestamp
 *   processedAt:      Timestamp | null
 *   processingStatus: 'pending' | 'success' | 'error' | 'duplicate' | 'skipped'
 *   processingError:  string | null
 *   resultIds:        string[] — Firestore invoice doc IDs created/updated
 */

const { admin, db } = require('./firebase.cjs');

const COLLECTION = 'raw_documents';

/**
 * Save a raw document to staging BEFORE processing.
 * Returns the staging document ID for later update.
 */
async function stageDocument({ type, companyId, source, storageUrl = null, rawText = null }) {
    try {
        const ref = db.collection(COLLECTION).doc(); // auto-ID
        await ref.set({
            type:             type || 'unknown',
            companyId:        companyId || null,
            source:           {
                subject:    source.subject    || '',
                from:       source.from       || '',
                date:       source.date       || '',
                filename:   source.filename   || '',
                messageUid: source.messageUid || null,
            },
            storageUrl:       storageUrl,
            rawText:          rawText ? rawText.slice(0, 50000) : null, // cap at 50k chars
            receivedAt:       admin.firestore.FieldValue.serverTimestamp(),
            processedAt:      null,
            processingStatus: 'pending',
            processingError:  null,
            resultIds:        [],
        });
        console.log(`[Staging] 📥 Saved raw document: ${ref.id} (${type} · ${source.filename})`);
        return ref.id;
    } catch (err) {
        // Staging failure must NEVER block the main pipeline
        console.warn(`[Staging] ⚠️  Could not save to staging: ${err.message}`);
        return null;
    }
}

/**
 * Update a staging document after processing completes.
 */
async function markStagingResult(stagingId, { status, resultIds = [], error = null, storageUrl = null }) {
    if (!stagingId) return;
    try {
        const update = {
            processedAt:      admin.firestore.FieldValue.serverTimestamp(),
            processingStatus: status,
            processingError:  error || null,
        };
        if (resultIds.length > 0) update.resultIds = resultIds;
        if (storageUrl) update.storageUrl = storageUrl;
        await db.collection(COLLECTION).doc(stagingId).update(update);
    } catch (err) {
        console.warn(`[Staging] ⚠️  Could not update staging result: ${err.message}`);
    }
}

/**
 * Get a raw document from staging by ID.
 */
async function getStagedDocument(stagingId) {
    const doc = await db.collection(COLLECTION).doc(stagingId).get();
    if (!doc.exists) throw new Error(`Staging document ${stagingId} not found`);
    return { id: doc.id, ...doc.data() };
}

/**
 * List recent staging documents, optionally filtered by company/status.
 */
async function listStagedDocuments({ companyId = null, status = null, limit = 50 } = {}) {
    let q = db.collection(COLLECTION);
    
    // If filtering by fields, drop orderBy to avoid requiring complex composite indexes.
    if (companyId) q = q.where('companyId', '==', companyId);
    if (status)    q = q.where('processingStatus', '==', status);
    
    if (!companyId && !status) {
        q = q.orderBy('receivedAt', 'desc');
    }
    
    q = q.limit(limit);
    
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

module.exports = { stageDocument, markStagingResult, getStagedDocument, listStagedDocuments };
