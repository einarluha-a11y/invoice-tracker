// document_ai_service.cjs — Google Document AI extraction engine (no Claude/Anthropic)
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { serviceAccount } = require('./core/firebase.cjs');
// --- Google Document AI Setup ---
const docaiClient = new DocumentProcessorServiceClient({
    credentials: serviceAccount,
    apiEndpoint: 'eu-documentai.googleapis.com'
});
const PROJECT_ID = 'invoice-tracker-xyz';
const LOCATION = 'eu';
const PROCESSOR_ID = '8087614a36686ed4'; // Invoice Parser
const PROCESSOR_NAME = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

/**
 * Parse a numeric string into a float, handling European formats (1.200,50 or 1,200.50)
 */
function cleanNum(str) {
    if (!str && str !== 0) return 0;
    let s = String(str).replace(/[^\d.,-]/g, '').trim();
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    return parseFloat(s) || 0;
}

/**
 * Convert Document AI date mentionText (various formats) to YYYY-MM-DD string.
 */
function parseDocAiDate(text) {
    if (!text) return null;
    // DocAI often returns YYYY-MM-DD or MM/DD/YYYY or DD.MM.YYYY
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const euroSlash = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (euroSlash) {
        const [, d, m, y] = euroSlash;
        const year = y.length === 2 ? `20${y}` : y;
        return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
}

/**
 * Infer description from vendor name when document has no explicit service description.
 */
function inferDescription(vendorName) {
    const v = (vendorName || '').toLowerCase();
    if (/nunner|girteka|linava|dsv|transport|freight|logistics|cargo|express|kuller|post/i.test(v)) return 'Freight forwarding';
    if (/kindlustus|insurance|assurance/i.test(v)) return 'Insurance premium';
    if (/rent|üür|arrend/i.test(v)) return 'Office rent';
    return 'Services';
}

/**
 * Main extraction function — replaces the former Claude-based engine.
 * Signature is kept identical so imap_daemon.cjs needs no changes.
 *
 * @param {Buffer} buffer       Raw file bytes (PDF or image)
 * @param {string} mimeType     MIME type, e.g. 'application/pdf'
 * @param {string|null} supervisorCritique  Ignored (no LLM loop) — kept for API compat
 * @param {string|null} customRules         Ignored (no LLM loop) — kept for API compat
 * @param {string|null} vendorHint          Ignored — kept for API compat
 * @returns {Promise<Array>} Array of invoice objects or []
 */
async function processInvoiceWithDocAI(buffer, mimeType = 'application/pdf', supervisorCritique = null, customRules = null, vendorHint = null) {
    console.log(`[DocAI] 📄 Sending document to Google Document AI Invoice Parser (${PROCESSOR_ID})...`);

    try {
        const request = {
            name: PROCESSOR_NAME,
            rawDocument: {
                content: buffer.toString('base64'),
                mimeType: mimeType || 'application/pdf',
            },
        };

        const [result] = await docaiClient.processDocument(request);
        const { document } = result;

        if (!document || !document.entities || document.entities.length === 0) {
            console.warn('[DocAI] ⚠️  Document AI returned no entities — document may be junk/empty.');
            return [];
        }

        // --- Map Document AI entities to invoice schema ---
        let vendorName = 'Unknown Vendor';
        let invoiceId = `Auto-${Date.now()}`;
        let dateCreated = null;
        let dueDate = null;
        let amount = 0;
        let taxAmount = 0;
        let subtotalAmount = 0;
        let currency = 'EUR';
        let supplierVat = 'Not_Found';
        let supplierRegistration = 'Not_Found';
        let receiverName = '';
        let receiverVat = '';
        let paymentTerms = '';
        let descriptionText = '';
        const lineItems = [];
        const confidenceScores = {};

        for (const entity of document.entities) {
            const text = (entity.mentionText || '').trim();
            const conf = entity.confidence || 0;

            switch (entity.type) {
                case 'supplier_name':
                    vendorName = text;
                    confidenceScores.vendor = conf;
                    break;
                case 'invoice_id':
                    invoiceId = text;
                    confidenceScores.invoiceId = conf;
                    break;
                case 'invoice_date':
                case 'issue_date':
                    dateCreated = parseDocAiDate(text);
                    break;
                case 'due_date':
                    dueDate = parseDocAiDate(text);
                    break;
                case 'total_amount':
                    amount = cleanNum(text);
                    confidenceScores.total = conf;
                    break;
                case 'total_tax_amount':
                    taxAmount = cleanNum(text);
                    break;
                case 'net_amount':
                case 'subtotal':
                    subtotalAmount = cleanNum(text);
                    break;
                case 'currency':
                    currency = text.toUpperCase() || 'EUR';
                    break;
                case 'supplier_tax_id':
                    supplierVat = text || 'Not_Found';
                    break;
                case 'supplier_registration_number':
                    supplierRegistration = text || 'Not_Found';
                    break;
                case 'receiver_name':
                    receiverName = text;
                    break;
                case 'receiver_tax_id':
                    receiverVat = text;
                    break;
                case 'payment_terms':
                    paymentTerms = text;
                    break;
                case 'description':
                case 'service_description':
                    if (text && text.length > 3) descriptionText = text;
                    break;
                case 'line_item': {
                    let itemDesc = '';
                    let itemAmt = 0;
                    if (entity.properties) {
                        const d = entity.properties.find(p => p.type === 'line_item/description');
                        const a = entity.properties.find(p => p.type === 'line_item/amount');
                        if (d) itemDesc = (d.mentionText || '').replace(/\n/g, ' ').trim();
                        if (a) itemAmt = cleanNum(a.mentionText);
                    }
                    if (itemDesc || itemAmt) lineItems.push({ description: itemDesc, amount: itemAmt });
                    break;
                }
            }
        }

        // --- Fallbacks ---
        if (!dateCreated) dateCreated = new Date().toISOString().split('T')[0];
        if (!dueDate) dueDate = dateCreated; // No due date → clone creation date

        // If subtotal+tax not available but total is, keep total as amount
        if (subtotalAmount === 0 && taxAmount === 0 && amount > 0) {
            subtotalAmount = amount; // Best guess
        }

        // Infer description
        const description = descriptionText && descriptionText.length > 3
            ? descriptionText
            : (lineItems.length > 0 ? lineItems[0].description : inferDescription(vendorName));

        // Determine status — DocAI doesn't extract "paid" status, default OOTEL
        const status = 'OOTEL';

        // --- Validation warnings ---
        const validationWarnings = [];
        const computedTotal = parseFloat((subtotalAmount + taxAmount).toFixed(2));
        if (amount > 0 && subtotalAmount > 0 && Math.abs(computedTotal - amount) > 0.05) {
            validationWarnings.push(`Math mismatch: ${subtotalAmount} + ${taxAmount} ≠ ${amount}`);
        }
        if ((confidenceScores.total || 0) < 0.6 || (confidenceScores.vendor || 0) < 0.6) {
            validationWarnings.push(`Low DocAI confidence: total=${(confidenceScores.total||0).toFixed(2)}, vendor=${(confidenceScores.vendor||0).toFixed(2)}`);
        }
        if (amount === 0) {
            validationWarnings.push('Total amount not extracted — manual review required');
        }

        console.log(`[DocAI] ✅ Extraction complete: vendor="${vendorName}", invoiceId="${invoiceId}", amount=${amount} ${currency}`);

        return [{
            type: 'INVOICE',
            invoiceId,
            vendorName,
            supplierRegistration,
            supplierVat,
            receiverName,
            receiverVat,
            amount,
            taxAmount,
            subtotalAmount,
            currency,
            dateCreated,
            dueDate,
            status,
            description,
            paymentTerms,
            lineItems,
            validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined,
        }];

    } catch (error) {
        console.error(`[DocAI] 🚨 Extraction failed:`, error.message);
        throw error;
    }
}

module.exports = { processInvoiceWithDocAI };
