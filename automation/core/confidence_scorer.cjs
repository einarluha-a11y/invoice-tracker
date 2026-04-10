/**
 * Confidence Scorer — extract per-field confidence from Azure Document Intelligence,
 * compute aggregate metrics, and decide review queue eligibility.
 *
 * Azure returns a `confidence` (0..1) on every recognized field. We surface this
 * to Firestore so the dashboard can flag low-confidence invoices, the Repairman
 * can prioritize them, and the anomaly detector can weigh extracted values.
 *
 * Used by: document_ai_service.cjs (Scout step 1)
 */

'use strict';

// Threshold below which a field is considered "low confidence"
// 0.85 chosen empirically — Azure prebuilt-invoice typically scores well-formed
// fields at 0.9+. Anything under 0.85 deserves a human glance.
const LOW_CONFIDENCE_THRESHOLD = 0.85;

// Mapping of Azure field names → invoice schema field names. Only fields on
// this list are graded; line items are scored separately if needed later.
const AZURE_FIELD_MAP = {
    VendorName:            'vendorName',
    InvoiceId:             'invoiceId',
    InvoiceDate:           'dateCreated',
    DueDate:               'dueDate',
    InvoiceTotal:          'amount',
    SubTotal:              'subtotalAmount',
    TotalTax:              'taxAmount',
    VendorTaxId:           'supplierVat',
    PaymentTerm:           'paymentTerms',
};

/**
 * Extract per-field confidence scores from an Azure Document Intelligence document.
 *
 * @param {object} azureDoc — single document from result.documents[0..n]
 * @returns {{
 *   confidenceScores: Object<string, number>,  // field name → confidence 0..1
 *   minFieldConfidence: number,                // worst score among populated fields
 *   avgConfidence: number,                     // mean of populated field scores
 *   lowConfidenceFields: string[],             // fields under LOW_CONFIDENCE_THRESHOLD
 * }}
 */
function extractConfidenceScores(azureDoc) {
    const confidenceScores = {};
    const lowConfidenceFields = [];

    if (!azureDoc || !azureDoc.fields) {
        return { confidenceScores, minFieldConfidence: 0, avgConfidence: 0, lowConfidenceFields };
    }

    const fields = azureDoc.fields;
    let sum = 0;
    let count = 0;
    let min = 1;

    for (const [azureName, schemaName] of Object.entries(AZURE_FIELD_MAP)) {
        const f = fields[azureName];
        if (!f) continue;
        // Only score populated fields. Empty/missing fields don't have a meaningful confidence.
        const hasValue = f.value !== undefined && f.value !== null && f.value !== '';
        if (!hasValue) continue;

        const c = typeof f.confidence === 'number' ? f.confidence : 0;
        confidenceScores[schemaName] = c;
        sum += c;
        count += 1;
        if (c < min) min = c;
        if (c < LOW_CONFIDENCE_THRESHOLD) lowConfidenceFields.push(schemaName);
    }

    const avg = count > 0 ? sum / count : 0;
    const minFieldConfidence = count > 0 ? min : 0;

    return {
        confidenceScores,
        minFieldConfidence,
        avgConfidence: avg,
        lowConfidenceFields,
    };
}

/**
 * Decide overall extraction quality based on Azure result.
 * Returns 'high' | 'medium' | 'low'.
 *
 * 'low' triggers immediate NEEDS_REVIEW status (skip Repairman — it can only
 * make things worse on garbage OCR).
 *
 * @param {object} azureResult — full result from poller.pollUntilDone()
 * @param {{minFieldConfidence: number, avgConfidence: number}} scores
 */
function classifyExtractionQuality(azureResult, scores) {
    if (!azureResult) return 'low';

    // Page-level OCR sanity check: too few text lines = scanned junk / blank page
    const pages = Array.isArray(azureResult.pages) ? azureResult.pages : [];
    const totalLines = pages.reduce((sum, p) => sum + (Array.isArray(p.lines) ? p.lines.length : 0), 0);

    if (totalLines < 5) return 'low';
    if (scores.avgConfidence > 0 && scores.avgConfidence < 0.6) return 'low';
    if (scores.minFieldConfidence > 0 && scores.minFieldConfidence < 0.5) return 'low';

    if (scores.avgConfidence < 0.85) return 'medium';
    if (scores.minFieldConfidence < LOW_CONFIDENCE_THRESHOLD) return 'medium';

    return 'high';
}

module.exports = {
    extractConfidenceScores,
    classifyExtractionQuality,
    LOW_CONFIDENCE_THRESHOLD,
    AZURE_FIELD_MAP,
};
