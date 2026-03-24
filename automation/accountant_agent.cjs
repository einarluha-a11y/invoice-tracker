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
    // --- 0. BANK STATEMENT INTERCEPTOR ---
    if (docAiPayload.type === 'BANK_STATEMENT') {
        console.log(`\n[Accountant Agent] 🏦 Bank Statement Detected! Initiating Auto-Reconciliation for: ${docAiPayload.vendorName} [Amount: ${docAiPayload.amount}]`);
        try {
            const invoicesRef = db.collection('invoices');
            const snap = await invoicesRef.where('companyId', '==', companyId)
                                          .where('status', 'in', ['Unpaid', 'Pending', 'OOTEL', 'Needs Action', 'Duplicate'])
                                          .get();
            let matched = false;
            if (!snap.empty) {
                for (const doc of snap.docs) {
                    const parseNum = (val) => {
                        let s = String(val || '').trim();
                        if (s.includes(',') && s.includes('.')) {
                            if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
                            else s = s.replace(/,/g, '');
                        } else if (s.includes(',')) s = s.replace(',', '.');
                        return parseFloat(s) || 0;
                    };
                    const invAmt = Math.abs(parseNum(invData.amount));
                    const payAmt = Math.abs(parseNum(docAiPayload.amount));
                    
                    if (Math.abs(invAmt - payAmt) < 0.05) {
                        const vName = String(invData.vendorName || '').toLowerCase();
                        const bName = String(docAiPayload.vendorName || '').toLowerCase();
                        const ref = String(docAiPayload.paymentReference || '').toLowerCase();
                        const invId = String(invData.invoiceId || '').toLowerCase();
                        
                        if (vName.includes(bName) || bName.includes(vName) || (invId.length > 3 && ref.includes(invId))) {
                            console.log(`[Accountant Agent] 🪙 MATCH FOUND! Reconciling Invoice ${invData.invoiceId} (${invData.vendorName}) as 'Paid' / Makstud!`);
                            await doc.ref.update({ status: 'Paid' });
                            matched = true;
                            break;
                        }
                    }
                }
            }
            if (!matched) {
                console.log(`[Accountant Agent] ⚠️ No unsettled invoice found for payment: ${docAiPayload.amount} to ${docAiPayload.vendorName}.`);
                
                // Enforce the strict 2026 boundary rule
                const paymentDate = new Date(docAiPayload.dateCreated || '2020-01-01');
                const cutoffDate = new Date('2026-01-01');
                
                if (paymentDate >= cutoffDate || String(docAiPayload.dateCreated).includes('2026')) {
                    console.log(`[Accountant Agent] 🚨 Payment falls within 2026 imperative window! Escalating to Search Agent...`);
                    const { findAndInjectMissingInvoice } = require('./search_agent.cjs');
                    const recovered = await findAndInjectMissingInvoice(docAiPayload.vendorName, docAiPayload.amount, companyId);
                    
                    if (recovered) {
                        console.log(`[Accountant Agent] 🕵️‍♂️ Search Agent found the missing invoice! Reconciling it as 'Paid'...`);
                        await db.collection('invoices').doc(recovered.id).update({ status: 'Paid' });
                    } else {
                        console.log(`[Accountant Agent] 📉 Search Agent could not locate the invoice in the email archives.`);
                    }
                } else {
                     console.log(`[Accountant Agent] ⏭️ Payment is prior to the 01.01.2026 strict boundary. Skipping Search Agent escalation.`);
                }
            }
        } catch(err) {
            console.error(err);
        }
        // Throw special error to gracefully abort the Invoice creation pipeline!
        throw new Error("BANK_STATEMENT_RECONCILIATION_COMPLETE");
    }

    console.log(`\n[Accountant Agent] 🚀 Beginning Audit for ${docAiPayload.vendorName} (Inv: ${docAiPayload.invoiceId})`);
    
    let systemStatus = docAiPayload.status || 'Pending';
    let warnings = docAiPayload.validationWarnings || [];

    // --- 1. PRE-FLIGHT AUDIT: File Integrity ---
    if (!fileUrl) {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: PDF File URL is missing.`);
        warnings.push("CRITICAL: Original PDF document was lost or failed to upload.");
        return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
    }

    // --- 1.2. PRE-FLIGHT AUDIT: THE CROSS-COMPANY ROUTING PROTOCOL (Rule 10) ---
    console.log(`[Accountant Agent] 🌐 Validating multi-tenant Receiver boundaries...`);
    const companiesSnap = await db.collection('companies').get();
    let bestMatchedCompanyId = null;
    let rxName = String(docAiPayload.receiverName || '').toLowerCase().trim();

    if (rxName && rxName !== 'not_found' && rxName !== 'unknown') {
        let matchedSomething = false;
        
        companiesSnap.forEach(doc => {
            const cleanCompName = String(doc.data().name || '').toLowerCase().replace(/oü|as|llc|inc|ltd/gi, '').replace(/\\s+/g, '').trim();
            const cleanRxName = rxName.replace(/oü|as|llc|inc|ltd/gi, '').replace(/\\s+/g, '').trim();
            
            if (cleanCompName.length > 3 && cleanRxName.includes(cleanCompName)) {
                bestMatchedCompanyId = doc.id;
                matchedSomething = true;
            }
        });

        if (!matchedSomething) {
            console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: Receiver name '${docAiPayload.receiverName}' does not map to any registered corporate entity in the local matrix. Rejected as SPAM. (Rule 10)`);
            warnings.push("CRITICAL SPAM FILTER: Target Receiver name bears no relation to internal registered companies. Document rejected.");
            return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
        } else if (bestMatchedCompanyId && bestMatchedCompanyId !== companyId) {
            console.log(`[Accountant Agent] 🔄 CROSS-COMPANY REROUTING: Document mathematically designated for target ${bestMatchedCompanyId}, overriding incorrect inbound SMTP matrix payload ${companyId}!`);
            companyId = bestMatchedCompanyId; 
        } else {
            console.log(`[Accountant Agent] ✅ Identity boundary verified. Proceeding on default trajectory.`);
        }
    } else {
         console.warn(`[Accountant Agent] ⚠️ Receiver Name absent or unreadable. Defaulting to inbound vector payload.`);
    }

    // --- 1.5. PRE-FLIGHT AUDIT: Zero-Value Enforcement ---
    const parseNumGlobal = (val) => {
        let s = String(val || '').trim();
        if (s.includes(',') && s.includes('.')) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (s.includes(',')) s = s.replace(',', '.');
        return parseFloat(s) || 0;
    };
    const numericAmount = parseNumGlobal(docAiPayload.amount);
    
    if (isNaN(numericAmount) || numericAmount === 0 || !docAiPayload.vendorName || docAiPayload.vendorName === 'Unknown') {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: Non-compliant payload (Amount: ${numericAmount}, Vendor: ${docAiPayload.vendorName}). System blocks junk interpretations.`);
        warnings.push("CRITICAL: Extracted amount is zero or Vendor missing. Interpreted as Junk image.");
        return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
    }

    // --- 1.7. PRE-FLIGHT AUDIT: Missing Registration/VAT Enforcement ---
    if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "") {
        docAiPayload.supplierRegistration = "Not_Found";
        warnings.push("CRITICAL: Supplier Registration Number is missing from the physical document.");
        systemStatus = 'Needs Action';
    }
    if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "") {
        docAiPayload.supplierVat = "Not_Found";
        warnings.push("CRITICAL: Supplier VAT Number is missing from the physical document.");
        systemStatus = 'Needs Action';
    }

    // --- 1.8. PRE-FLIGHT AUDIT: KREEDITARVE (CREDIT NOTE) PROTOCOL ---
    if (numericAmount < 0 || String(docAiPayload.amount).trim().startsWith('-')) {
        console.log(`[Accountant Agent] 🟢 KREEDITARVE DETECTED: Amount bears a minus sign (${docAiPayload.amount}). Automatically settling as 'Paid' per Rule 9.`);
        systemStatus = 'Paid';
        warnings.push("NOTE: Kreeditarve (Credit Note) detected via minus sign. System autonomously settled status to 'Paid'.");
    }

    // --- 2. PRE-FLIGHT AUDIT: Deduplication ---
    if (docAiPayload.invoiceId && docAiPayload.vendorName && docAiPayload.amount) {
        console.log(`[Accountant Agent] 🔍 Checking Firestore for Duplicates natively using Deep Fuzzy Logic...`);
        const duplicateCheck = await db.collection('invoices')
            .where('companyId', '==', companyId)
            .get();
        
        const isDuplicate = duplicateCheck.docs.some(doc => {
            const data = doc.data();
            const cleanNewId = String(docAiPayload.invoiceId || '').replace(/[^a-zA-Z0-9]/g, '');
            const cleanOldId = String(data.invoiceId || '').replace(/[^a-zA-Z0-9]/g, '');
            
            const amtMatches = Math.abs((parseFloat(data.amount)||0) - parseFloat(docAiPayload.amount)) < 0.05;
            
            const newVendor = String(docAiPayload.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const oldVendor = String(data.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            // vendorName overlap check safely prevents 'Anthropic Ireland Limited' from missing 'Anthropic Ireland, Limited'
            const vendorFuzzyMatch = (newVendor.length > 3 && oldVendor.length > 3) ? (newVendor.includes(oldVendor) || oldVendor.includes(newVendor)) : false;
            
            // If invoices sport a strong structurally rich Signature that matches
            const strongIdMatch = (cleanNewId.length > 3 && cleanOldId === cleanNewId);
            
            // Fallback for weak or missing IDs (e.g., generic receipts): Date + Amount + Vendor must perfectly overlap
            const genericDateMatch = (cleanNewId.length <= 3 && amtMatches && vendorFuzzyMatch && data.dateCreated === docAiPayload.dateCreated);

            return (strongIdMatch && vendorFuzzyMatch && amtMatches) || genericDateMatch;
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
        
        // Ensure Pre-Paid and Krediitarve locks are impenetrable
        if (systemStatus !== 'Paid' && systemStatus !== 'Duplicate') {
            // Only escalate to Needs Action if it isn't strictly locked by higher rules
            if (aiAnalysis.recommendedStatus === 'Needs Action' || warnings.length > 0) {
                systemStatus = 'Needs Action';
            }
        } else {
             console.log(`[Accountant Agent] 🔒 Immutable 'Paid' status preserved despite ${warnings.length} warnings.`);
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
