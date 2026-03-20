const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const path = require('path');

// --- Document AI Setup ---
const docaiClient = new DocumentProcessorServiceClient({
    keyFilename: path.join(__dirname, 'google-credentials.json'),
    apiEndpoint: 'eu-documentai.googleapis.com'
});
const PROJECT_ID = 'invoice-tracker-xyz';
const LOCATION = 'eu';
const PROCESSOR_ID = '8087614a36686ed4'; // Invoice Parser
const PROCESSOR_NAME = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

/**
 * Processes a raw file buffer using Google Cloud Document AI's Invoice Parser.
 * Maps the entities to the Invoice Tracker DB Schema.
 */
async function processInvoiceWithDocAI(fileBuffer, mimeType) {
    if (!fileBuffer) throw new Error("File buffer is required for Document AI");
    
    // Ensure accurate mime/type
    const validMime = mimeType === 'application/pdf' || mimeType.includes('image/') ? mimeType : 'application/pdf';

    console.log(`[Document AI] Sending to Invoice Parser (${PROCESSOR_ID}) with precise MIME type: ${validMime}`);
    
    try {
        const request = {
            name: PROCESSOR_NAME,
            rawDocument: {
                content: fileBuffer.toString('base64'),
                mimeType: validMime,
            },
        };
        const [result] = await docaiClient.processDocument(request);
        const { document } = result;

        let parsedData = {
            vendorName: 'Unknown',
            invoiceId: `Auto-${Date.now()}`,
            dateCreated: '',
            dueDate: '',
            subtotal: 0,
            tax: 0,
            total: 0,
            currency: 'EUR',
            lineItems: [],
            confidenceScores: {}
        };

        if (document.entities) {
            for (const entity of document.entities) {
                const text = entity.mentionText;
                const conf = entity.confidence;
                const cleanNum = (str) => parseFloat(String(str).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;

                if (entity.type === 'supplier_name') { parsedData.vendorName = text; parsedData.confidenceScores.vendor = conf; }
                if (entity.type === 'invoice_id') { parsedData.invoiceId = text; parsedData.confidenceScores.invoiceId = conf; }
                if (entity.type === 'invoice_date') { 
                    const isoText = entity.normalizedValue && entity.normalizedValue.text ? entity.normalizedValue.text : text.split(' ')[0];
                    parsedData.dateCreated = isoText.includes('T') ? isoText.split('T')[0] : isoText; 
                }
                if (entity.type === 'due_date') { 
                    const isoText = entity.normalizedValue && entity.normalizedValue.text ? entity.normalizedValue.text : text.split(' ')[0];
                    parsedData.dueDate = isoText.includes('T') ? isoText.split('T')[0] : isoText; 
                }
                if (entity.type === 'total_amount') { parsedData.total = cleanNum(text); parsedData.confidenceScores.total = conf; }
                if (entity.type === 'total_tax_amount') { parsedData.tax = cleanNum(text); parsedData.confidenceScores.tax = conf; }
                if (entity.type === 'subtotal') { parsedData.subtotal = cleanNum(text); parsedData.confidenceScores.subtotal = conf; }
                if (entity.type === 'currency') parsedData.currency = text;
                
                if (entity.type === 'line_item') {
                    let desc = '', amt = 0;
                    if (entity.properties) {
                        const d = entity.properties.find(p => p.type === 'line_item/description');
                        const a = entity.properties.find(p => p.type === 'line_item/amount');
                        if (d) desc = d.mentionText.replace(/\n/g, ' ');
                        if (a) amt = cleanNum(a.mentionText);
                    }
                    parsedData.lineItems.push({ description: desc, amount: amt });
                }
            }
        }

        // --- FALLBACKS & VALIDATION RULES ---
        let validationWarnings = [];
        let systemStatus = 'Unpaid'; // Maps to 'Pending' via api.ts parseStatus

        // Subtotal fallback if missing but solvable
        if (parsedData.subtotal === 0 && parsedData.total > 0 && parsedData.tax > 0) {
            parsedData.subtotal = parseFloat((parsedData.total - parsedData.tax).toFixed(2));
            console.log(`[Document AI] Recovered missing subtotal: ${parsedData.subtotal}`);
        }

        // Fix non-ISO dates manually if normalization failed (e.g. 28.02.2026 -> 2026-02-28)
        const fixDate = (dateStr) => {
            if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
                const parts = dateStr.split('.');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            return dateStr;
        };
        parsedData.dateCreated = fixDate(parsedData.dateCreated);
        parsedData.dueDate = fixDate(parsedData.dueDate);

        const computedTotal = parseFloat((parsedData.subtotal + parsedData.tax).toFixed(2));
        if (parsedData.total > 0 && Math.abs(computedTotal - parsedData.total) > 0.05) {
            validationWarnings.push(`Mathematics mismatch: Subtotal (${parsedData.subtotal}) + Tax (${parsedData.tax}) != Total (${parsedData.total})`);
            systemStatus = 'Needs Action';
        }

        if ((parsedData.confidenceScores.total && parsedData.confidenceScores.total < 0.85) || 
            (parsedData.confidenceScores.vendor && parsedData.confidenceScores.vendor < 0.85)) {
            validationWarnings.push(`Low confidence score detected from OCR (Total: ${parsedData.confidenceScores.total}, Vendor: ${parsedData.confidenceScores.vendor})`);
            systemStatus = 'Needs Action';
        }

        if (!parsedData.dueDate) parsedData.dueDate = parsedData.dateCreated;

        // Map strictly to InvoiceTracker array requirement
        return [{
            invoiceId: parsedData.invoiceId,
            vendorName: parsedData.vendorName,
            amount: parsedData.total,
            taxAmount: parsedData.tax,
            subtotalAmount: parsedData.subtotal,
            currency: parsedData.currency,
            dateCreated: parsedData.dateCreated || new Date().toISOString().split('T')[0],
            dueDate: parsedData.dueDate || new Date().toISOString().split('T')[0],
            status: systemStatus,
            lineItems: parsedData.lineItems,
            validationWarnings: validationWarnings
        }];

    } catch (err) {
        console.error("[DocAI Error]", err);
        throw err;
    }
}

module.exports = { processInvoiceWithDocAI };
