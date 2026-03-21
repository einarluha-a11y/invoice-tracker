const express = require('express');
const cors = require('cors');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const admin = require('firebase-admin');
const path = require('path');
const crypto = require('crypto');

// --- Google Cloud / Firebase Setup ---
const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app' // Using existing bucket
    });
}
const db = admin.firestore();
const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

// --- Document AI Setup ---
const docaiClient = new DocumentProcessorServiceClient({
    keyFilename: path.join(__dirname, 'google-credentials.json'),
    apiEndpoint: 'eu-documentai.googleapis.com'
});
const PROJECT_ID = 'invoice-tracker-xyz';
const LOCATION = 'eu';
const PROCESSOR_ID = '8087614a36686ed4'; // The created Invoice Parser
const PROCESSOR_NAME = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * Step 1: INTAKE 
 * Route that Zapier hits when an email/file triggers.
 */
app.post('/api/intake', async (req, res) => {
    try {
        const { fileUrl, fileName, senderUrl, companyId } = req.body;
        
        if (!fileUrl) return res.status(400).json({ error: "Missing fileUrl" });

        // Download file into memory buffer (acts as the bridge from Zapier to GCP)
        console.log(`[Step 1: Intake] Downloading file from Zapier URL: ${fileUrl}`);
        const fileResponse = await fetch(fileUrl);
        const arrayBuf = await fileResponse.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuf);
        const mimeType = fileResponse.headers.get('content-type') || 'application/pdf';

        // --- Step 2 & 3: FILE CLASSIFICATION & PREPROCESSING ---
        // Document AI handles multi-page splitting, OCR on images vs PDFs, and de-skewing natively.
        console.log(`[Step 2/3: Preprocessing] Classifying and analyzing File type: ${mimeType}`);

        // --- Step 4: STRUCTURED EXTRACTION ---
        console.log(`[Step 4: Extraction] Sending to Document AI Invoice Parser (${PROCESSOR_ID})`);
        const request = {
            name: PROCESSOR_NAME,
            rawDocument: {
                content: fileBuffer.toString('base64'),
                mimeType,
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
            confidenceScores: {},
            originalFileUrl: null
        };

        // Parse Document AI Entities into structured JSON schema
        if (document.entities) {
            for (const entity of document.entities) {
                const text = entity.mentionText;
                const conf = entity.confidence;
                const cleanNum = (str) => parseFloat(String(str).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;

                if (entity.type === 'supplier_name') { parsedData.vendorName = text; parsedData.confidenceScores.vendor = conf; }
                if (entity.type === 'invoice_id') { parsedData.invoiceId = text; parsedData.confidenceScores.invoiceId = conf; }
                if (entity.type === 'invoice_date') { parsedData.dateCreated = text.split(' ')[0]; } // Usually ISO format output by DocAI
                if (entity.type === 'due_date') { parsedData.dueDate = text.split(' ')[0]; }
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

        // --- Step 5: VALIDATION + BUSINESS RULES ---
        console.log(`[Step 5: Validation] Running math and confidence checks...`);
        let validationWarnings = [];
        let systemStatus = 'Unpaid';

        // Math check
        const computedTotal = parseFloat((parsedData.subtotal + parsedData.tax).toFixed(2));
        if (Math.abs(computedTotal - parsedData.total) > 0.05) {
            // Very common OCR issue: it missed a tax line or misread subtotal
            validationWarnings.push(`Mathematics mismatch: Subtotal (${parsedData.subtotal}) + Tax (${parsedData.tax}) != Total (${parsedData.total})`);
            systemStatus = 'Needs Action'; // Overrides Unpaid if math is broken
        }

        // Confidence check
        if (parsedData.confidenceScores.total < 0.85 || parsedData.confidenceScores.vendor < 0.85) {
            validationWarnings.push(`Low confidence score detected from OCR (Total: ${parsedData.confidenceScores.total}, Vendor: ${parsedData.confidenceScores.vendor})`);
            systemStatus = 'Needs Action';
        }

        // Due date business rule
        if (!parsedData.dueDate) parsedData.dueDate = parsedData.dateCreated;

        // --- Secure Storage Upload ---
        const cleanName = fileName ? fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') : `Zapier-DocAI-${Date.now()}.pdf`;
        const filePath = `invoices/${companyId || 'UNKNOWN'}/${Date.now()}_${cleanName}`;
        const uuid = crypto.randomUUID();
        await bucket.file(filePath).save(fileBuffer, { metadata: { contentType: mimeType, metadata: { firebaseStorageDownloadTokens: uuid } } });
        parsedData.originalFileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${uuid}`;

        // --- Step 6: ROUTING ---
        console.log(`[Step 6: Routing] Status determined as: ${systemStatus}. Writing to DB...`);
        
        // Write exactly to Invoice Tracker's required DB model
        const docRef = db.collection('invoices').doc();
        await docRef.set({
            invoiceId: parsedData.invoiceId,
            vendorName: parsedData.vendorName,
            amount: parsedData.total,
            taxAmount: parsedData.tax,        // NEW: Saved for API integrations
            subtotalAmount: parsedData.subtotal, // NEW
            currency: parsedData.currency,
            dateCreated: parsedData.dateCreated || new Date().toISOString().split('T')[0],
            dueDate: parsedData.dueDate || new Date().toISOString().split('T')[0],
            status: systemStatus,
            companyId: companyId || 'bP6dc0PMdFtnmS5QTX4N',
            fileUrl: parsedData.originalFileUrl,
            lineItems: parsedData.lineItems,  // NEW: Saving arrays into Firestore directly
            validationWarnings: validationWarnings,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send Success to Zapier
        res.status(200).json({
            message: "Invoice Intelligence Pipeline Completed",
            docId: docRef.id,
            extractedData: parsedData,
            warnings: validationWarnings,
            finalStatus: systemStatus
        });

    } catch (err) {
        console.error("Pipeline Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Export the Express App so it can be mounted by the primary server
module.exports = app;
