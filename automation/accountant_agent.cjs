// accountant_agent.cjs — ГЛАВНЫЙ БУХГАЛТЕР (Chief Accountant Agent)
// No external AI dependencies — pure rule-based logic.

const { validateVat } = require('./vies_validator.cjs');
const { admin, db } = require('./core/firebase.cjs');
const { enrichCompanyData } = require('./company_enrichment.cjs');
const { cleanNum } = require('./core/utils.cjs');

// parseAmount = cleanNum (backward compat alias)
const parseAmount = cleanNum;

// ── Companies cache (TTL 5 min) — avoids re-reading all companies per invoice ──
let _companiesCache = null;
let _companiesCacheTime = 0;
const COMPANIES_CACHE_TTL = 5 * 60 * 1000;

async function getCachedCompanies() {
    const now = Date.now();
    if (_companiesCache && now - _companiesCacheTime < COMPANIES_CACHE_TTL) return _companiesCache;
    const snap = await db.collection('companies').get();
    _companiesCache = snap;
    _companiesCacheTime = now;
    return snap;
}

/**
 * Fuzzy vendor name match — checks if either name contains the other.
 */
function vendorMatches(invData, paymentData) {
    const vName = String(invData.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const bName = String(paymentData.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ref = String(paymentData.paymentReference || '').toLowerCase();
    const invId = String(invData.invoiceId || '').toLowerCase();
    return (vName.length > 3 && bName.length > 3 && (vName.includes(bName) || bName.includes(vName))) ||
           (invId.length > 3 && ref.includes(invId));
}

/**
 * ГЛАВНЫЙ БУХГАЛТЕР (Chief Accountant Agent).
 * Enforces Zero-Defect Guarantee: Pre-flight checks, VIES validation,
 * rule-based compliance audit, partial payments, credit note offset.
 * No AI dependencies — pure business logic.
 */
async function auditAndProcessInvoice(docAiPayload, fileUrl, companyId) {
    // --- 0. BANK STATEMENT INTERCEPTOR (with partial payment support) ---
    if (docAiPayload.type === 'BANK_STATEMENT') {
        console.log(`\n[Accountant Agent] 🏦 Bank Statement Detected! Initiating Auto-Reconciliation for: ${docAiPayload.vendorName} [Amount: ${docAiPayload.amount}]`);
        try {
            const invoicesRef = db.collection('invoices');
            const snap = await invoicesRef.where('companyId', '==', companyId)
                                          .where('status', 'in', ['Unpaid', 'Pending', 'OOTEL', 'NEEDS_REVIEW', 'Needs Action', 'Overdue'])
                                          .get();
            let matched = false;
            const payAmt = Math.abs(parseAmount(docAiPayload.amount));

            if (!snap.empty) {
                // Pass 1: Try exact match on remainingAmount (full payment of remaining)
                for (const doc of snap.docs) {
                    const invData = doc.data();
                    const remaining = invData.remainingAmount ?? Math.abs(parseAmount(invData.amount));

                    if (Math.abs(remaining - payAmt) < 0.50 && vendorMatches(invData, docAiPayload)) {
                        console.log(`[Accountant Agent] 🪙 FULL PAYMENT MATCH! Reconciling Invoice ${invData.invoiceId} (${invData.vendorName}) as 'Paid'!`);
                        await db.runTransaction(async (t) => {
                            const freshDoc = await t.get(doc.ref);
                            if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                            const origAmount = freshDoc.data().originalAmount || freshDoc.data().amount;
                            t.update(doc.ref, {
                                status: 'Paid',
                                amount: origAmount,
                                remainingAmount: 0,
                                payments: admin.firestore.FieldValue.arrayUnion({
                                    amount: payAmt,
                                    date: docAiPayload.dateCreated || new Date().toISOString().split('T')[0],
                                    reference: docAiPayload.paymentReference || '',
                                }),
                            });
                        });
                        matched = true;
                        break;
                    }
                }

                // Pass 2: Try partial payment (payAmt < remainingAmount)
                if (!matched) {
                    for (const doc of snap.docs) {
                        const invData = doc.data();
                        const remaining = invData.remainingAmount ?? Math.abs(parseAmount(invData.amount));

                        if (payAmt > 0 && payAmt < remaining && vendorMatches(invData, docAiPayload)) {
                            const newRemaining = parseFloat((remaining - payAmt).toFixed(2));
                            console.log(`[Accountant Agent] 💰 PARTIAL PAYMENT: ${payAmt}/${remaining} for ${invData.invoiceId}. Remaining: ${newRemaining}`);
                            await db.runTransaction(async (t) => {
                                const freshDoc = await t.get(doc.ref);
                                if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                                t.update(doc.ref, {
                                    status: 'Pending',
                                    remainingAmount: newRemaining,
                                    payments: admin.firestore.FieldValue.arrayUnion({
                                        amount: payAmt,
                                        date: docAiPayload.dateCreated || new Date().toISOString().split('T')[0],
                                        reference: docAiPayload.paymentReference || '',
                                    }),
                                });
                            });
                            matched = true;
                            break;
                        }
                    }
                }
            }

            if (!matched) {
                console.log(`[Accountant Agent] ⚠️ No unsettled invoice found for payment: ${docAiPayload.amount} to ${docAiPayload.vendorName}.`);

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
                    console.log(`[Accountant Agent] ⏭️ Payment is prior to ${cutoffYear} boundary. Skipping Search Agent.`);
                }
            }
        } catch(err) {
            console.error(err);
        }
        // ── Save transaction to bank_transactions archive ──────────────
        try {
            await db.collection('bank_transactions').add({
                companyId,
                date: docAiPayload.dateCreated || null,
                amount: payAmt,
                reference: docAiPayload.paymentReference || '',
                counterparty: docAiPayload.vendorName || '',
                matchedInvoiceId: matched ? 'matched_inline' : null,
                source: 'accountant_interceptor',
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (archiveErr) {
            console.warn(`[Accountant] Failed to archive bank transaction: ${archiveErr.message}`);
        }

        throw new Error("BANK_STATEMENT_RECONCILIATION_COMPLETE");
    }

    // --- 0.5. NON-INVOICE DOCUMENT FILTER ---
    // Reject documents that are not invoices: CMR, waybills, packing lists, delivery notes, etc.
    {
        const filename = String(fileUrl || '').toLowerCase();
        const invId = String(docAiPayload.invoiceId || '').toLowerCase();
        const vendor = String(docAiPayload.vendorName || '').toLowerCase();
        const rawText = String(docAiPayload._rawText || '').toLowerCase();
        // Check filename + vendor + header (not description — transport invoices reference CMR numbers in descriptions)
        const allText = `${filename} ${invId} ${vendor} ${rawText.slice(0, 500)}`;

        // Strong CMR markers in document header (early rejection)
        const CMR_HEADERS = [
            /international\s+consignment\s+note/i,
            /tarptautinis\s+krovinių\s+transportavimo\s+važtaraštis/i,
            /международная\s+товарно-транспортная/i,
            /lettre\s+de\s+voiture\s+internationale/i,
        ];
        if (CMR_HEADERS.some(p => p.test(rawText.slice(0, 1000)))) {
            console.error(`[Accountant Agent] 🛑 NON-INVOICE FILTER: CMR header detected in document (file: ${filename})`);
            return null;
        }

        const NON_INVOICE_PATTERNS = [
            // Transport documents
            /\bcmr\b/, /\bwaybill\b/, /\bsaateleht\b/, /\bpacking\s*list\b/,
            /\bdelivery\s*note\b/, /\btransport\s*doc/,
            // Contracts & agreements
            /\bcontract\b/, /\bagreement\b/, /\bleping\b/, /\bдоговор\b/, /\bumowa\b/,
            // Appendices & annexes
            /\bappendix\b/, /\bannex\b/, /\blisa\b/, /\bприложение\b/, /\bzałącznik\b/,
            // Insurance
            /\binsurance\b/, /\bkindlustus\b/, /\bстрахов/,  /\bubezpieczeni/,
            // Vehicle documents
            /\btech\s*passport\b/, /\bregistration\s*cert/, /\btehniline\s*pass/,
            /\bтех\s*паспорт\b/, /\bсвидетельство\s*о\s*рег/,
            // Driver documents
            /\bdriver.?licen[sc]e\b/, /\bpassport\b/, /\bpass\b/, /\bjuhilub/,
            /\bпаспорт\b/, /\bводительск/, /\bprawo\s*jazdy/,
            // Quotes & offers (not invoices)
            /\bpro\s*forma\b/, /\bquotation\b/, /\boffer\b/,
            /\bpakkuda\b/, /\bhinnapakkumine\b/,
            // Power of attorney
            /\bpower\s*of\s*attorney\b/, /\bvolikiri\b/, /\bдоверенность\b/,
        ];

        const isNonInvoice = NON_INVOICE_PATTERNS.some(p => p.test(allText));

        // Additional heuristic: if invoiceId looks like "CMR", "PS38 dd.", or contains no digits
        const idLooksWrong = invId && (
            /^cmr/i.test(invId) ||
            /\bdd\.?\s*$/i.test(invId) ||
            !/\d/.test(invId)
        );

        if (isNonInvoice || (idLooksWrong && filename.includes('cmr'))) {
            console.error(`[Accountant Agent] 🛑 NON-INVOICE FILTER: Document rejected — not an invoice (file: ${filename}, id: ${invId})`);
            return null;
        }
    }

    // --- 0.6. SELF-INVOICE GUARD: receiver company can never be the vendor ---
    // All registered companies (that receive invoices) are checked.
    // If vendor VAT/Reg matches any registered company → data was extracted from buyer section.
    {
        const companiesSnap = await getCachedCompanies();
        const invVat = (docAiPayload.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const invReg = (docAiPayload.supplierRegistration || '').replace(/[^0-9]/g, '');

        for (const compDoc of companiesSnap.docs) {
            const comp = compDoc.data();
            const compVat = (comp.vat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const compReg = (comp.regCode || '').replace(/[^0-9]/g, '');

            const vatMatch = (compVat && invVat && compVat === invVat) || (compReg && invVat && invVat.endsWith(compReg));
            const regMatch = compReg && invReg && compReg === invReg;

            if (vatMatch || regMatch) {
                console.log(`[Accountant Agent] ⚠️ SELF-INVOICE GUARD: vendor VAT/Reg matches receiver "${comp.name}". Clearing buyer data from vendor fields.`);
                // Clear fields that belong to the buyer, not the vendor
                if (vatMatch) docAiPayload.supplierVat = '';
                if (regMatch) docAiPayload.supplierRegistration = '';
                // Don't clear vendorName — DocAI may have extracted the real vendor elsewhere
                break;
            }
        }
    }

    console.log(`\n[Accountant Agent] 🚀 Beginning Audit for ${docAiPayload.vendorName} (Inv: ${docAiPayload.invoiceId})`);

    let systemStatus = docAiPayload.status || 'Pending';
    let warnings = docAiPayload.validationWarnings || [];

    // --- 1. PRE-FLIGHT AUDIT: File Integrity ---
    if (!fileUrl || fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
        if (fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
            // Body-text invoice — no file is expected, but we enforce a strict
            // COMPLETENESS GATE: body-text records without all four key fields
            // are rejected as junk/partial-parse to prevent skeleton records on dashboard.
            fileUrl = null;

            const hasVendor    = !!(docAiPayload.vendorName && docAiPayload.vendorName !== 'Unknown' && docAiPayload.vendorName !== 'UNKNOWN VENDOR' && docAiPayload.vendorName !== 'Not_Found');
            const hasAmount    = parseAmount(docAiPayload.amount) > 0;
            const hasInvoiceId = !!(docAiPayload.invoiceId && !String(docAiPayload.invoiceId).startsWith('DRAFT-') && String(docAiPayload.invoiceId).length > 2);
            const hasVat       = !!(docAiPayload.supplierVat && !['Not_Found','NOT_FOUND_ON_INVOICE','not_found',''].includes(String(docAiPayload.supplierVat).trim()));
            const hasReg       = !!(docAiPayload.supplierRegistration && !['Not_Found','NOT_FOUND_ON_INVOICE','not_found',''].includes(String(docAiPayload.supplierRegistration).trim()));

            const score = [hasVendor, hasAmount, hasInvoiceId, (hasVat || hasReg)].filter(Boolean).length;

            // ALL 4 fields required: score 3/4 (missing VAT/Reg) still rejected.
            // Nunner-type records with vendor+amount+invoiceId but no VAT/Reg are blocked here.
            if (score < 4) {
                console.error(`[Accountant Agent] 🛑 BODY-TEXT COMPLETENESS GATE: Rejected — score ${score}/4 (vendor:${hasVendor} amount:${hasAmount} invoiceId:${hasInvoiceId} vat/reg:${hasVat||hasReg})`);
                warnings.push(`COMPLETENESS_GATE: Body-text record rejected (score ${score}/4). ALL required: vendor name, positive amount, invoice number, and VAT or registration number. Forward the original PDF instead.`);
                return null; // Don't save incomplete body-text records
            }

            warnings.push("NOTE: Invoice extracted from email body text — no PDF attachment. Passed completeness gate.");
            console.warn(`[Accountant Agent] ⚠️  Body-text invoice accepted (score ${score}/4): ${docAiPayload.vendorName} / ${docAiPayload.invoiceId}`);
        } else {
            console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: PDF File URL is missing.`);
            warnings.push("CRITICAL: Original PDF document was lost or failed to upload.");
            return null; // Don't save records without files
        }
    }

    // --- 1.2. PRE-FLIGHT AUDIT: THE CROSS-COMPANY ROUTING PROTOCOL (Rule 10) ---
    console.log(`[Accountant Agent] 🌐 Validating multi-tenant Receiver boundaries...`);
    const companiesSnap = await getCachedCompanies();
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
            return null; // Don't save spam/misrouted records
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
        return null; // Don't save junk records
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

        // Final state after enrichment attempt — missing VAT/Reg is NOT an error, leave empty for manual fill
        if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "") {
            docAiPayload.supplierRegistration = "";
            warnings.push("INFO: Supplier Registration Number not found — can be filled manually.");
        }

        // Missing VAT is only a CRITICAL issue if the invoice actually charges VAT (taxAmount > 0).
        // VAT-exempt suppliers (leasing, financial services, small businesses below threshold)
        // legitimately have no VAT number — do not quarantine them for this.
        const invoiceChargesVat = docAiPayload.taxAmount && parseFloat(docAiPayload.taxAmount) > 0;
        if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "") {
            docAiPayload.supplierVat = "";
            warnings.push("INFO: Supplier VAT not found — can be filled manually.");
        }
    }

    // --- 1.8. PRE-FLIGHT AUDIT: KREEDITARVE (CREDIT NOTE) PROTOCOL ---
    if (numericAmount < 0 || String(docAiPayload.amount).trim().startsWith('-')) {
        console.log(`[Accountant Agent] 🟢 KREEDITARVE DETECTED: Amount ${docAiPayload.amount}. Status → 'Paid'. Will offset matching invoice.`);
        systemStatus = 'Paid';
        warnings.push("NOTE: Kreeditarve (Credit Note) detected. Separate record with negative amount, status 'Paid'.");

        // Try to find and offset the original invoice
        const creditAmount = Math.abs(numericAmount);
        try {
            const pendingSnap = await db.collection('invoices')
                .where('companyId', '==', companyId)
                .where('status', 'in', ['Unpaid', 'Pending', 'OOTEL', 'Needs Action', 'Overdue'])
                .limit(200)
                .get();

            let offsetApplied = false;
            for (const pendingDoc of pendingSnap.docs) {
                const pData = pendingDoc.data();
                if (!vendorMatches(pData, docAiPayload)) continue;

                const pRemaining = pData.remainingAmount ?? Math.abs(parseAmount(pData.amount));

                if (Math.abs(pRemaining - creditAmount) <= 0.05) {
                    // Exact match — mark original as Paid
                    console.log(`[Accountant Agent] ⚖️ Credit note exactly offsets invoice ${pData.invoiceId}. Marking as Paid.`);
                    await pendingDoc.ref.update({
                        status: 'Paid',
                        remainingAmount: 0,
                        creditNoteId: docAiPayload.invoiceId || null,
                    });
                    offsetApplied = true;
                    break;
                } else if (creditAmount < pRemaining) {
                    // Partial credit — reduce remaining
                    const newRemaining = parseFloat((pRemaining - creditAmount).toFixed(2));
                    console.log(`[Accountant Agent] ⚖️ Partial credit: ${creditAmount} off ${pRemaining}. New remaining: ${newRemaining}`);
                    await pendingDoc.ref.update({
                        remainingAmount: newRemaining,
                        creditNoteId: docAiPayload.invoiceId || null,
                    });
                    offsetApplied = true;
                    break;
                }
            }
            if (!offsetApplied) {
                console.log(`[Accountant Agent] ⚠️ No matching invoice found to offset with credit note.`);
            }
        } catch (creditErr) {
            console.warn(`[Accountant Agent] Credit note offset failed: ${creditErr.message}`);
        }
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
            
            // Defeat Zapier: Zapier scrambles IDs (e.g. 26226030115526/4211005197) while Claude extracts correctly (4211005197).
            // We consider it a fuzzy match if either string fully encapsulates the other.
            const idFuzzyMatch = (cleanNewId.length > 3 && cleanOldId.length > 3 && (cleanOldId.includes(cleanNewId) || cleanNewId.includes(cleanOldId)));
            const isZapierGhost = (!data.fileUrl && data.subtotalAmount === undefined);

            // COMPANY SUFFIX RULE: invoiceId + amount match even if vendor names differ
            // If one has a legal entity suffix (AS, OÜ, GmbH, etc.) — that's the real name.
            // The other is likely a brand/product name extracted from the PDF (e.g. "VOLVO" vs "Info-Auto AS").
            const LEGAL_SUFFIXES = /\b(AS|OÜ|OY|AB|GmbH|AG|SIA|UAB|BV|NV|Ltd|LLC|Inc|S\.?A\.?|Sp\.?\s*z\s*o\.?\s*o\.?|SARL|SAS|e\.K\.)\b/i;
            const strongIdAmtMatch = (strongIdMatch && amtMatches && !vendorFuzzyMatch);
            const existingHasSuffix = LEGAL_SUFFIXES.test(data.vendorName || '');
            const incomingHasSuffix = LEGAL_SUFFIXES.test(docAiPayload.vendorName || '');

            const isDuplicateMatch = (strongIdMatch && vendorFuzzyMatch && amtMatches) ||
                                     genericDateMatch ||
                                     (idFuzzyMatch && vendorFuzzyMatch && amtMatches) ||
                                     (isZapierGhost && vendorFuzzyMatch && amtMatches && data.dateCreated === docAiPayload.dateCreated) ||
                                     strongIdAmtMatch; // same invoiceId + amount, different vendor = likely same invoice

            if (isDuplicateMatch) {
                const dbNoFile = !data.fileUrl || data.fileUrl === 'BODY_TEXT_NO_ATTACHMENT';
                // Incoming payload is "better" if it has a real PDF OR if it contains advanced DocAI metadata (subtotal/tax) that Zapier missed.
                const incomingIsBetter = (fileUrl && fileUrl !== 'BODY_TEXT_NO_ATTACHMENT') || docAiPayload.subtotalAmount !== undefined || docAiPayload.taxAmount !== undefined;

                // COMPANY SUFFIX RULE: if same invoiceId+amount but different vendor names,
                // prefer the name with a legal entity suffix (AS, OÜ, GmbH, etc.)
                if (strongIdAmtMatch && !vendorFuzzyMatch) {
                    if (incomingHasSuffix && !existingHasSuffix) {
                        // Incoming has proper company name — replace existing
                        console.log(`[Accountant Agent] ⚔️ COMPANY NAME UPGRADE: "${data.vendorName}" → "${docAiPayload.vendorName}" (has legal suffix). Destroying ${doc.id}.`);
                        ghostDocIdToDestroy = doc.id;
                    } else if (existingHasSuffix && !incomingHasSuffix) {
                        // Existing already has proper name — skip incoming
                        console.log(`[Accountant Agent] 🛑 DUPLICATE: "${docAiPayload.vendorName}" rejected — "${data.vendorName}" already has legal suffix.`);
                        isDuplicate = true;
                    } else {
                        // Both or neither have suffix — keep existing
                        isDuplicate = true;
                    }
                } else if (dbNoFile && incomingIsBetter) {
                    console.log(`[Accountant Agent] ⚔️ GHOST ASSASSINATION: Destroying skeleton duplicate ${doc.id} in favor of full DocAI payload!`);
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
                // The ghost must still exist and must still lack a proper fileUrl to be assassinated.
                if (ghostDoc.exists && (!ghostDoc.data().fileUrl || ghostDoc.data().fileUrl === 'BODY_TEXT_NO_ATTACHMENT')) {
                    console.log(`[Accountant Agent] 🗑️  Ghost verified and deleted via Transaction lock: ${ghostDocIdToDestroy}`);
                    t.delete(ghostRef);
                } else {
                    console.warn(`[Accountant Agent] ⚠️  Ghost deletion aborted: doc state changed or file now present (${ghostDocIdToDestroy})`);
                    ghostDocIdToDestroy = null; // Don't skip the incoming record
                    isDuplicate = true;
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

    // --- 4. RULE-BASED ACCOUNTING AUDIT (Claude disabled) ---
    console.log(`[Accountant Agent] 🔢 Running rule-based compliance audit (no AI)...`);
    {
        // Apply the same 3 compliance rules that Claude was checking, but in code
        const aiAnalysis = { recommendedStatus: 'Pending', generatedWarnings: [] };

        // Rule 1: VAT charged but VIES says supplier is invalid
        if (docAiPayload.taxAmount > 0 && viesResult && viesResult.isValid === false) {
            aiAnalysis.generatedWarnings.push('CRITICAL: Supplier charges VAT but VIES validation returned invalid — possible fraud.');
            aiAnalysis.recommendedStatus = 'Needs Action';
        }
        // Rule 2: Tax amount present but no supplierVat extracted
        if (docAiPayload.taxAmount > 0 && (!docAiPayload.supplierVat || docAiPayload.supplierVat === 'Not_Found')) {
            aiAnalysis.generatedWarnings.push('INFO: Tax charged but supplier VAT number not found on document.');
        }
        // Rule 3: Math check subtotal + tax = total
        if (docAiPayload.subtotalAmount > 0 && docAiPayload.taxAmount > 0) {
            const computed = parseFloat((docAiPayload.subtotalAmount + docAiPayload.taxAmount).toFixed(2));
            if (Math.abs(computed - docAiPayload.amount) > 0.05) {
                aiAnalysis.generatedWarnings.push(`INFO: Math check — ${docAiPayload.subtotalAmount} + ${docAiPayload.taxAmount} = ${computed} ≠ ${docAiPayload.amount}`);
            }
        }

        console.log(`[Accountant Agent] 📝 Rule-based audit done. Status: ${aiAnalysis.recommendedStatus}`);
        
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

    }

    // --- OVERDUE CHECK: if dueDate is in the past and not Paid/Duplicate → Overdue ---
    if (systemStatus !== 'Paid' && systemStatus !== 'Duplicate' && docAiPayload.dueDate) {
        const due = new Date(docAiPayload.dueDate);
        const today = new Date();
        due.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        if (!isNaN(due.getTime()) && today.getTime() > due.getTime()) {
            console.log(`[Accountant Agent] ⏰ dueDate ${docAiPayload.dueDate} is past → status Overdue`);
            systemStatus = 'Overdue';
        }
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
