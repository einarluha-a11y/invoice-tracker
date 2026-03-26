/**
 * SAFETY NET AGENT
 * Rule 31: Zero Invoice Loss Guarantee
 *
 * This module is called whenever any stage of the pipeline rejects or fails
 * to process an invoice. Instead of silently discarding it, the Safety Net
 * saves a DRAFT record to Firestore so no invoice is ever permanently lost.
 *
 * DRAFT records appear on the dashboard with a clear "NEEDS REVIEW" status
 * and a warning explaining why the normal pipeline rejected them.
 */

const admin = require('firebase-admin');

async function safetyNetSave(rawData, reason, companyId, fileUrl = null) {
    try {
        const db = admin.firestore();

        // Build minimal record from whatever data we have
        const draftRecord = {
            vendorName: rawData.vendorName || rawData.vendor || 'UNKNOWN VENDOR',
            invoiceId: rawData.invoiceId || `DRAFT-${Date.now()}`,
            amount: rawData.amount || null,
            currency: rawData.currency || 'EUR',
            dateCreated: rawData.dateCreated || rawData.issueDate || new Date().toISOString().split('T')[0],
            dueDate: rawData.dueDate || null,
            supplierVat: rawData.supplierVat || 'Not_Found',
            supplierRegistration: rawData.supplierRegistration || 'Not_Found',
            fileUrl: fileUrl || rawData.fileUrl || null,
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
