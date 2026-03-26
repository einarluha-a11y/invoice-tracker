/**
 * SAFETY NET AGENT
 * Rule 31: Every record on the dashboard MUST have the original invoice file attached.
 *
 * This module is called whenever the normal pipeline fails to process an invoice
 * BUT a file was successfully uploaded to Firebase Storage.
 *
 * CRITICAL INVARIANT: safetyNetSave() NEVER saves a record without a fileUrl.
 * If there is no file, it logs the failure and returns null — no garbage record
 * is created on the dashboard. A record without a file is worse than no record.
 */

const admin = require('firebase-admin');

async function safetyNetSave(rawData, reason, companyId, fileUrl = null) {
    // HARD RULE: never save a record without the original invoice file.
    // A dashboard entry with no file attached is misleading and unacceptable.
    const resolvedFileUrl = fileUrl || rawData.fileUrl || null;
    if (!resolvedFileUrl) {
        console.warn(`[Safety Net] ⚠️  Skipping DRAFT — no file to attach. Reason was: ${reason}`);
        console.warn(`[Safety Net]    → Fix the Firebase Storage upload issue to recover this invoice.`);
        return null;
    }

    try {
        const db = admin.firestore();

        // Build minimal record from whatever data we have.
        // Use 'UNKNOWN VENDOR' rather than the filename if AI couldn't extract a real name.
        const rawVendor = rawData.vendorName || rawData.vendor || '';
        const looksLikeFilename = /\.(pdf|jpg|jpeg|png|tiff?)$/i.test(rawVendor);
        const vendorName = (rawVendor && !looksLikeFilename) ? rawVendor : 'UNKNOWN VENDOR';

        const draftRecord = {
            vendorName,
            invoiceId: rawData.invoiceId || `DRAFT-${Date.now()}`,
            invoiceId: rawData.invoiceId || `DRAFT-${Date.now()}`,
            amount: rawData.amount || null,
            currency: rawData.currency || 'EUR',
            dateCreated: rawData.dateCreated || rawData.issueDate || new Date().toISOString().split('T')[0],
            dueDate: rawData.dueDate || null,
            supplierVat: rawData.supplierVat || 'Not_Found',
            supplierRegistration: rawData.supplierRegistration || 'Not_Found',
            fileUrl: resolvedFileUrl,
            companyId: companyId || rawData.companyId || null,
            status: 'NEEDS_REVIEW',
            validationWarnings: [
                `SAFETY NET: Invoice saved as DRAFT because normal pipeline rejected it.`,
                `Rejection reason: ${reason}`,
                ...(rawData.validationWarnings || [])
            ],
            safetyNetCapturedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Check for duplicate DRAFT (same invoiceId + vendor in last 24h)
        if (draftRecord.invoiceId && !draftRecord.invoiceId.startsWith('DRAFT-')) {
            const existing = await db.collection('invoices')
                .where('invoiceId', '==', draftRecord.invoiceId)
                .where('status', '==', 'NEEDS_REVIEW')
                .limit(1)
                .get();
            if (!existing.empty) {
                console.log(`[Safety Net] Skipping duplicate DRAFT for invoiceId=${draftRecord.invoiceId}`);
                return null;
            }
        }

        const ref = await db.collection('invoices').add(draftRecord);
        console.log(`[Safety Net] ✅ Saved DRAFT record: ${ref.id} (vendor: ${draftRecord.vendorName}, reason: ${reason})`);
        return ref.id;
    } catch (err) {
        console.error(`[Safety Net] ❌ CRITICAL: Even Safety Net failed to save:`, err.message);
        return null;
    }
}

module.exports = { safetyNetSave };
