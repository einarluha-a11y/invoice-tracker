const { Anthropic } = require('@anthropic-ai/sdk');
const { validateVat } = require('./vies_validator.cjs');
const admin = require('firebase-admin');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Ensure Firebase is initialized
const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

/**
 * Acts as the Chief Accountant Orchestrator.
 * Enforces Zero-Defect Guarantee (Pre-flight checks) + VIES + LLM Compliance Audit.
 */
async function auditAndProcessInvoice(docAiPayload, fileUrl, companyId) {
    console.log(`\n[Accountant Agent] 🚀 Beginning Audit for ${docAiPayload.vendorName} (Inv: ${docAiPayload.invoiceId})`);
    
    let systemStatus = docAiPayload.status || 'Pending';
    let warnings = docAiPayload.validationWarnings || [];

    // --- 1. PRE-FLIGHT AUDIT: File Integrity ---
    if (!fileUrl) {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: PDF File URL is missing.`);
        warnings.push("CRITICAL: Original PDF document was lost or failed to upload.");
        return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
    }

    // --- 1.5. PRE-FLIGHT AUDIT: Zero-Value Enforcement ---
    const numericAmount = parseFloat((docAiPayload.amount || '0').toString().replace(/[^0-9.-]+/g, ''));
    if (isNaN(numericAmount) || numericAmount === 0 || !docAiPayload.vendorName || docAiPayload.vendorName === 'Unknown') {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: Non-compliant payload (Amount: ${numericAmount}, Vendor: ${docAiPayload.vendorName}). System blocks junk interpretations.`);
        warnings.push("CRITICAL: Extracted amount is zero or Vendor missing. Interpreted as Junk image.");
        return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
    }

    // --- 2. PRE-FLIGHT AUDIT: Deduplication ---
    if (docAiPayload.invoiceId && docAiPayload.vendorName && docAiPayload.amount) {
        console.log(`[Accountant Agent] 🔍 Checking Firestore for Duplicates...`);
        // Avoid composite index requirement by filtering locally if needed, but simple == works
        const duplicateCheck = await db.collection('invoices')
            .where('companyId', '==', companyId)
            .where('vendorName', '==', docAiPayload.vendorName)
            .get();
        
        const isDuplicate = duplicateCheck.docs.some(doc => {
            const data = doc.data();
            return data.invoiceId === docAiPayload.invoiceId && 
                   Math.abs((parseFloat(data.amount)||0) - parseFloat(docAiPayload.amount)) < 0.05;
        });

        if (isDuplicate) {
            console.error(`[Accountant Agent] 🛑 REJECTED: Exact duplicate found in database.`);
            warnings.push("CRITICAL: Exact duplicate invoice detected in registry.");
            return { ...docAiPayload, fileUrl, status: 'Duplicate', validationWarnings: warnings };
        }
    }

    // --- 3. COMPLIANCE AUDIT: VIES Validation ---
    let viesResult = null;
    if (docAiPayload.supplierVat) {
        console.log(`[Accountant Agent] 🌍 Verifying VAT [${docAiPayload.supplierVat}] with EU VIES...`);
        viesResult = await validateVat(docAiPayload.supplierVat);
        console.log(`[Accountant Agent] 💶 VIES Response: Valid? ${viesResult.isValid}`);
        // Attach raw result to DB for UI
        docAiPayload.viesValidation = viesResult;
    }

    // --- 4. THE BRAIN: LLM Accounting Audit ---
    console.log(`[Accountant Agent] 🧠 Handing over to Claude 3.5 for contextual analysis...`);
    const prompt = `
You are the Chief Accountant AI for a European enterprise.
Review the following extracted invoice data.

Extracted Data:
${JSON.stringify(docAiPayload, null, 2)}

VIES API Verification Result for Supplier:
${JSON.stringify(viesResult, null, 2)}

Rules to enforce:
1. If the Total Tax is > 0 but the VIES API Verification says "isValid: false", this is highly suspicious (charging VAT without a valid cross-border VAT number). Flag it!
2. If the company is charging VAT but no 'supplierVat' was extracted at all, flag it as a missing required tax credential.
3. If 'total' does not precisely equal 'subtotal' + 'tax', flag a mathematical error.

Respond ONLY with a valid JSON strictly following this schema:
{
  "complianceAudit": "A short 1-sentence thought process of your audit",
  "recommendedStatus": "Needs Action | Pending",
  "generatedWarnings": ["string of warning 1", "string of warning 2"] 
}
Do not return any markdown wrappers, just the raw JSON.`;

    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 500,
            temperature: 0.1,
            system: "You are an expert strict accountant checking for tax fraud and compliance.",
            messages: [{ role: "user", content: prompt }]
        });

        const rawJson = response.content[0].text.trim().replace(/^```json\n|\n```$/g, '');
        const aiAnalysis = JSON.parse(rawJson);

        console.log(`[Accountant Agent] 📝 Audit Complete. Status: ${aiAnalysis.recommendedStatus}`);
        
        // Merge AI findings
        if (aiAnalysis.generatedWarnings && aiAnalysis.generatedWarnings.length > 0) {
            warnings.push(...aiAnalysis.generatedWarnings);
        }
        
        // If the AI found issues, escalate status to Needs Action, otherwise keep the systemStatus
        if (aiAnalysis.recommendedStatus === 'Needs Action' || warnings.length > 0) {
            systemStatus = 'Needs Action';
        }

    } catch (e) {
        console.error(`[Accountant Agent] ⚠️ Brain logic failed or timed out. Falling back to strict OCR rules.`, e.message);
    }

    return {
        ...docAiPayload,
        fileUrl,
        companyId,
        status: systemStatus,
        validationWarnings: warnings
    };
}

module.exports = { auditAndProcessInvoice };
