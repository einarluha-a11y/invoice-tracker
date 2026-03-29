const { Anthropic } = require('@anthropic-ai/sdk');
const { validateVat } = require('./vies_validator.cjs');
const { admin, db } = require('./core/firebase.cjs');
const { enrichCompanyData } = require('./company_enrichment.cjs');

/**
 * Shared amount parser — handles European (1.234,56) and US (1,234.56) formats.
 * Single source of truth. Replaces both local parseNum and parseNumGlobal.
 */
const parseAmount = (val) => {
    let s = String(val || '').trim().replace(/[€$£\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
    } else if (s.includes(',')) s = s.replace(',', '.');
    return parseFloat(s) || 0;
};

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

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
                                          .where('status', 'in', ['Unpaid', 'Pending', 'OOTEL', 'NEEDS_REVIEW', 'Needs Action', 'Overdue', 'Duplicate'])
                                          .get();
            let matched = false;
            if (!snap.empty) {
                for (const doc of snap.docs) {
                    const invData = doc.data();
                    const invAmt = Math.abs(parseAmount(invData.amount));
                    const payAmt = Math.abs(parseAmount(docAiPayload.amount));

                    // Tolerance of €0.50 covers Revolut's €0.20 bank transfer commission
                    // and minor rounding differences between invoice and actual payment
                    if (Math.abs(invAmt - payAmt) < 0.50) {
                        const vName = String(invData.vendorName || '').toLowerCase();
                        const bName = String(docAiPayload.vendorName || '').toLowerCase();
                        const ref = String(docAiPayload.paymentReference || '').toLowerCase();
                        const invId = String(invData.invoiceId || '').toLowerCase();
                        
                        if (vName.includes(bName) || bName.includes(vName) || (invId.length > 3 && ref.includes(invId))) {
                            console.log(`[Accountant Agent] 🪙 MATCH FOUND! Reconciling Invoice ${invData.invoiceId} (${invData.vendorName}) as 'Paid' / Makstud!`);
                            await db.runTransaction(async (t) => {
                                const freshDoc = await t.get(doc.ref);
                                if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                                t.update(doc.ref, { status: 'Paid' });
                            });
                            matched = true;
                            break;
                        }
                    }
                }
            }
            if (!matched) {
                console.log(`[Accountant Agent] ⚠️ No unsettled invoice found for payment: ${docAiPayload.amount} to ${docAiPayload.vendorName}.`);
                
                // Search Agent is triggered for payments in the current year or later.
                // Override via SEARCH_AGENT_CUTOFF_YEAR env variable if needed (e.g. "2027").
                const paymentDate = new Date(docAiPayload.dateCreated || '2020-01-01');
                const cutoffYear = parseInt(process.env.SEARCH_AGENT_CUTOFF_YEAR || new Date().getFullYear(), 10);
                const cutoffDate = new Date(`${cutoffYear}-01-01`);

                if (paymentDate >= cutoffDate || String(docAiPayload.dateCreated).includes(String(cutoffYear))) {
                    console.log(`[Accountant Agent] 🚨 Payment falls within ${cutoffYear}+ window! Escalating to Search Agent...`);
                    const { findAndInjectMissingInvoice } = require('./search_agent.cjs');
                    const recovered = await findAndInjectMissingInvoice(docAiPayload.vendorName, docAiPayload.amount, companyId);
                    
                    if (recovered) {
                        console.log(`[Accountant Agent] 🕵️‍♂️ Search Agent found the missing invoice! Reconciling it as 'Paid'...`);
                        await db.runTransaction(async (t) => {
                            const recRef = db.collection('invoices').doc(recovered.id);
                            const recDoc = await t.get(recRef);
                            if (recDoc.exists && recDoc.data().status !== 'Paid') {
                                t.update(recRef, { status: 'Paid' });
                            }
                        });
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
    if (!fileUrl || fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
        if (fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
            // Body-text invoice — no file is expected, continue with null fileUrl
            fileUrl = null;
            warnings.push("NOTE: Invoice extracted from email body text — no PDF attachment.");
        } else {
            console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: PDF File URL is missing.`);
            warnings.push("CRITICAL: Original PDF document was lost or failed to upload.");
            return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
        }
    }

    // --- 1.2. PRE-FLIGHT AUDIT: THE CROSS-COMPANY ROUTING PROTOCOL (Rule 10) ---
    console.log(`[Accountant Agent] 🌐 Validating multi-tenant Receiver boundaries...`);
    const companiesSnap = await db.collection('companies').get();
    let bestMatchedCompanyId = null;
    let rxName = String(docAiPayload.receiverName || '').toLowerCase().trim();

    if (rxName && rxName !== 'not_found' && rxName !== 'unknown') {
        let matchedSomething = false;
        
        companiesSnap.forEach(doc => {
            const cleanCompName = String(doc.data().name || '').toLowerCase().replace(/oü|as|llc|inc|ltd/gi, '').replace(/\s+/g, '').trim();
            const cleanRxName = rxName.replace(/oü|as|llc|inc|ltd/gi, '').replace(/\s+/g, '').trim();
            
            if (cleanCompName.length > 3 && cleanRxName.includes(cleanCompName)) {
                bestMatchedCompanyId = doc.id;
                matchedSomething = true;
            }
        });

        if (!matchedSomething) {
            console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: Receiver name '${docAiPayload.receiverName}' does not map to any registered corporate entity in the local matrix. Rejected as SPAM. (Rule 10)`);
            warnings.push("CRITICAL SPAM FILTER: Target Receiver name bears no relation to internal registered companies. Document rejected.");
            return { ...docAiPayload, fileUrl, status: 'Error', validationWarnings: warnings };
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
    const numericAmount = parseAmount(docAiPayload.amount);
    
    if (isNaN(numericAmount) || numericAmount === 0 || !docAiPayload.vendorName || docAiPayload.vendorName === 'Unknown') {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: Non-compliant payload (Amount: ${numericAmount}, Vendor: ${docAiPayload.vendorName}). System blocks junk interpretations.`);
        warnings.push("CRITICAL: Extracted amount is zero or Vendor missing. Interpreted as Junk image.");
        return { ...docAiPayload, fileUrl, status: 'Error', validationWarnings: warnings };
    }

    const { isPrivatePerson } = require('./core/business_rules.cjs');
    const isPrivate = isPrivatePerson(docAiPayload.vendorName);

    if (isPrivate) {
        console.log(`[Accountant Agent] 👤 Vendor "${docAiPayload.vendorName}" appears to be a private person. VAT/Reg may not be required.`);
        
        // Scrub only Supervisor's VAT/Reg "missing data" warnings — private persons inherently
        // don't have these. Use a targeted pattern to avoid removing unrelated warnings.
        warnings = warnings.filter(w => !/SUPERVISOR:.*missing data.*(VAT|registration|reg)/i.test(w));
        docAiPayload.validationWarnings = warnings;

        // For private persons: missing VAT/Reg is safely ignored
        if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE") {
            docAiPayload.supplierVat = "Not_Found";
        }
        if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE") {
            docAiPayload.supplierRegistration = "Not_Found";
        }
    } else {
        const vatMissing = !docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "";
        const regMissing = !docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "";

        if (vatMissing || regMissing) {
            console.log(`[Accountant Agent] 🔍 VAT/Reg missing from document. Attempting government source lookup for: ${docAiPayload.vendorName}`);
            try {
                // Detect country hint from vendor name or existing VAT prefix
                const countryHint = docAiPayload.supplierVat?.match(/^([A-Z]{2})/)?.[1]
                    || (docAiPayload.vendorName?.match(/\bOÜ\b|\bAS\b/i)                  ? 'EE' : null)
                    || (docAiPayload.vendorName?.match(/\bUAB\b/i)                         ? 'LT' : null)
                    || (docAiPayload.vendorName?.match(/\bSIA\b/i)                         ? 'LV' : null)
                    || (docAiPayload.vendorName?.match(/Sp\.?\s*z\s*o\.?o\.?|S\.A\./i)    ? 'PL' : null)
                    || (docAiPayload.vendorName?.match(/\bGmbH\b|\bAG\b|\be\.K\.\b/i)     ? 'DE' : null)
                    || (docAiPayload.vendorName?.match(/\bSARL\b|\bSAS\b|\bSA\b/i)        ? 'FR' : null)
                    || (docAiPayload.vendorName?.match(/\bBV\b|\bNV\b/i)                  ? 'NL' : null)
                    || (docAiPayload.vendorName?.match(/\bLtd\b|\bPLC\b|\bLLP\b/i)        ? 'GB' : null)
                    || (docAiPayload.vendorName?.match(/\bAB\b/i)                          ? 'SE' : null)
                    || (docAiPayload.vendorName?.match(/\bОЮ\b|\bТОВ\b|\bФОП\b/i)        ? 'UA' : null)
                    || 'EE'; // Default to Estonia if no hint found

                const enriched = await enrichCompanyData(docAiPayload.vendorName, countryHint);

                if (enriched) {
                    if (vatMissing && enriched.vatNumber) {
                        docAiPayload.supplierVat = enriched.vatNumber;
                        docAiPayload.enrichmentSource = enriched.source;
                        warnings.push(`INFO: VAT number auto-enriched from ${enriched.source} (matched: "${enriched.matchedName}")`);
                        console.log(`[Accountant Agent] ✅ VAT enriched from ${enriched.source}: ${enriched.vatNumber}`);
                    }
                    if (regMissing && enriched.registrationNumber) {
                        docAiPayload.supplierRegistration = enriched.registrationNumber;
                        docAiPayload.enrichmentSource = enriched.source;
                        warnings.push(`INFO: Registration number auto-enriched from ${enriched.source} (matched: "${enriched.matchedName}")`);
                        console.log(`[Accountant Agent] ✅ Reg No enriched from ${enriched.source}: ${enriched.registrationNumber}`);
                    }
                }
            } catch (enrichErr) {
                console.warn(`[Accountant Agent] ⚠️ Enrichment lookup failed:`, enrichErr.message);
            }
        }

        // Final state after enrichment attempt
        if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "") {
            docAiPayload.supplierRegistration = "Not_Found";
            warnings.push("CRITICAL: Supplier Registration Number is missing from the physical document and could not be found in official sources.");
            systemStatus = 'Needs Action';
        }

        // Missing VAT is only a CRITICAL issue if the invoice actually charges VAT (taxAmount > 0).
        // VAT-exempt suppliers (leasing, financial services, small businesses below threshold)
        // legitimately have no VAT number — do not quarantine them for this.
        const invoiceChargesVat = docAiPayload.taxAmount && parseFloat(docAiPayload.taxAmount) > 0;
        if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "") {
            docAiPayload.supplierVat = "Not_Found";
            if (invoiceChargesVat) {
                // Charging VAT but no VAT registration number → genuine compliance issue
                warnings.push("CRITICAL: Supplier VAT Number is missing but invoice charges VAT. Could not be found in official sources.");
                systemStatus = 'Needs Action';
            } else {
                // No VAT on invoice — supplier may be VAT-exempt. Log as INFO only.
                warnings.push("INFO: Supplier VAT not found (invoice appears to be VAT-exempt — no tax amount charged).");
            }
        }
    }

    // --- 1.8. PRE-FLIGHT AUDIT: KREEDITARVE (CREDIT NOTE) PROTOCOL ---
    if (numericAmount < 0 || String(docAiPayload.amount).trim().startsWith('-')) {
        console.log(`[Accountant Agent] 🟢 KREEDITARVE DETECTED: Amount bears a minus sign (${docAiPayload.amount}). Automatically settling as 'Paid' per Rule 9.`);
        systemStatus = 'Paid';
        warnings.push("NOTE: Kreeditarve (Credit Note) detected via minus sign. System autonomously settled status to 'Paid'.");
    }

    // --- 2. PRE-FLIGHT AUDIT: Deduplication ---
    if (docAiPayload.invoiceId && docAiPayload.vendorName && docAiPayload.amount) {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        console.log(`[Accountant Agent] 🔍 Checking Firestore for Duplicates (Last 6 Months) natively using Deep Fuzzy Logic...`);
        const duplicateCheck = await db.collection('invoices')
            .where('companyId', '==', companyId)
            .where('createdAt', '>=', sixMonthsAgo)
            .get();
        
        let isDuplicate = false;
        let ghostDocIdToDestroy = null;

        for (let i = 0; i < duplicateCheck.docs.length; i++) {
            const doc = duplicateCheck.docs[i];
            const data = doc.data();
            const cleanNewId = String(docAiPayload.invoiceId || '').replace(/[^a-zA-Z0-9]/g, '');
            const cleanOldId = String(data.invoiceId || '').replace(/[^a-zA-Z0-9]/g, '');
            
            const amtMatches = Math.abs((parseFloat(data.amount)||0) - parseFloat(docAiPayload.amount)) < 0.05;
            
            const newVendor = String(docAiPayload.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const oldVendor = String(data.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const vendorFuzzyMatch = (newVendor.length > 3 && oldVendor.length > 3) ? (newVendor.includes(oldVendor) || oldVendor.includes(newVendor)) : false;
            
            const strongIdMatch = (cleanNewId.length > 3 && cleanOldId === cleanNewId);
            const genericDateMatch = (cleanNewId.length <= 3 && amtMatches && vendorFuzzyMatch && data.dateCreated === docAiPayload.dateCreated);

            if ((strongIdMatch && vendorFuzzyMatch && amtMatches) || genericDateMatch) {
                if ((!data.fileUrl || data.fileUrl === 'BODY_TEXT_NO_ATTACHMENT') && fileUrl && fileUrl !== 'BODY_TEXT_NO_ATTACHMENT') {
                    console.log(`[Accountant Agent] ⚔️ GHOST ASSASSINATION: Destroying file-less duplicate ${doc.id} in favor of incoming high-fidelity PDF payload!`);
                    ghostDocIdToDestroy = doc.id;
                } else {
                    isDuplicate = true;
                }
                break;
            }
        }

        if (ghostDocIdToDestroy) {
            // Safety: re-fetch before deletion — state may have changed since we found it
            const ghostRef = db.collection('invoices').doc(ghostDocIdToDestroy);
            await db.runTransaction(async (t) => {
                const ghostDoc = await t.get(ghostRef);
                if (ghostDoc.exists && !ghostDoc.data().fileUrl) {
                    console.log(`[Accountant Agent] 🗑️  Ghost verified and deleted via Transaction lock: ${ghostDocIdToDestroy}`);
                    t.delete(ghostRef);
                } else {
                    console.warn(`[Accountant Agent] ⚠️  Ghost deletion aborted: doc state changed or file now present (${ghostDocIdToDestroy})`);
                    ghostDocIdToDestroy = null; // Don't skip the incoming record
                }
            });
        }

        if (isDuplicate) {
            console.error(`[Accountant Agent] 🛑 REJECTED: Exact duplicate found in database.`);
            warnings.push("CRITICAL: Exact duplicate invoice detected in registry.");
            return { ...docAiPayload, fileUrl, status: 'Duplicate', validationWarnings: warnings };
        }
    }

    // --- 3. COMPLIANCE AUDIT: VIES Validation ---
    let viesResult = null;
    if (docAiPayload.supplierVat && docAiPayload.supplierVat !== 'Not_Found' && !isPrivate) {
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
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: process.env.AI_MODEL || "claude-sonnet-4-6",
            max_tokens: 500,
            temperature: 0.1,
            system: "You are an expert strict accountant checking for tax fraud and compliance.",
            messages: [{ role: "user", content: prompt }]
        });

        let rawJson = response.content[0].text.trim().replace(/^```json\n?|\n?```$/g, '').trim();
        const jsonStart = rawJson.indexOf('{');
        if (jsonStart > 0) rawJson = rawJson.slice(jsonStart);
        let aiAnalysis;
        try {
            aiAnalysis = JSON.parse(rawJson);
        } catch (parseErr) {
            // Use Pending as default — a parse failure is a system error, not evidence of a bad invoice.
            // The invoice already passed all hard validation rules above to reach this point.
            console.warn(`[Accountant Agent] ⚠️  AI audit response was not valid JSON. Using safe defaults (Pending).`);
            aiAnalysis = { recommendedStatus: 'Pending', generatedWarnings: ['NOTE: AI compliance audit parse failed — proceeding with rule-based validation only.'] };
        }

        console.log(`[Accountant Agent] 📝 Audit Complete. Status: ${aiAnalysis.recommendedStatus}`);
        
        // Merge AI findings
        if (aiAnalysis.generatedWarnings && aiAnalysis.generatedWarnings.length > 0) {
            warnings.push(...aiAnalysis.generatedWarnings);
        }
        
        // Ensure Pre-Paid and Krediitarve locks are impenetrable
        if (systemStatus !== 'Paid' && systemStatus !== 'Duplicate') {
            // Only escalate to Needs Action for genuine CRITICAL issues.
            // INFO: and NOTE: messages are metadata only — they never trigger quarantine.
            const hasCriticalWarning = warnings.some(w => w.startsWith('CRITICAL:'));
            if (aiAnalysis.recommendedStatus === 'Needs Action' || hasCriticalWarning) {
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

module.exports = { auditAndProcessInvoice, parseAmount };
