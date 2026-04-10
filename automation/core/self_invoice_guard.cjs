/**
 * Self-Invoice Guard — single source of truth.
 *
 * Problem: Scout (Azure Document Intelligence) sometimes extracts the BUYER's
 * fields into vendor slots — especially when the PDF layout puts the receiver
 * block near the top, or when a sender/receiver heading is ambiguous. This
 * leaks our own company (Global Technics OÜ, Ideacom OÜ, …) into vendorName,
 * supplierVat, and supplierRegistration — and that creates fake "self-invoices".
 *
 * Before this refactor, three different functions did nearly-the-same check:
 *   1. teacher_agent.cjs     — `validateAndTeach` section 0 (most thorough)
 *   2. accountant_agent.cjs  — `auditAndProcessInvoice` section 0.6 (just VAT/Reg)
 *   3. invoice_processor.cjs — `writeToFirestore` (last-line block-before-write)
 *
 * They disagreed on edge cases (name matching, what to clear, when to re-extract).
 * This module centralises the logic so all three can share the same rules.
 *
 * Used by: teacher_agent.cjs, accountant_agent.cjs, invoice_processor.cjs
 */

'use strict';

const NAME_MIN_LEN = 4; // shorter than this = too ambiguous to match on

/**
 * Normalize a string for buyer-leak comparison:
 * lowercase, strip everything except letters+digits (Estonian letters kept).
 */
function normalizeName(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
}

function normalizeId(s) {
    if (!s) return '';
    return String(s).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeDigits(s) {
    if (!s) return '';
    return String(s).replace(/[^0-9]/g, '');
}

/**
 * Check a single invoice against a collection of registered companies.
 * Returns a report describing how the invoice's vendor fields compare to
 * every registered receiver. Callers decide what to do with the findings.
 *
 * @param {object} invoice   — object with supplierVat/supplierRegistration/vendorName
 * @param {Array<{name: string, vat?: string, regCode?: string}>} receivers
 * @returns {{
 *   leaked: boolean,                       // any field leaked buyer data
 *   vatLeak: boolean,                      // supplierVat belongs to a buyer
 *   regLeak: boolean,                      // supplierRegistration belongs to a buyer
 *   nameLeak: boolean,                     // vendorName matches a buyer
 *   matchedCompanyName: string|null,       // the receiver that leaked
 *   buyerVatSet: Set<string>,              // ALL buyer VATs for regex skipping
 *   buyerRegSet: Set<string>,              // ALL buyer regCodes
 *   buyerNameSet: Set<string>              // ALL buyer names (normalized)
 * }}
 */
function inspectVendorFields(invoice, receivers) {
    const result = {
        leaked: false,
        vatLeak: false,
        regLeak: false,
        nameLeak: false,
        matchedCompanyName: null,
        buyerVatSet: new Set(),
        buyerRegSet: new Set(),
        buyerNameSet: new Set(),
    };

    const invVat  = normalizeId(invoice.supplierVat);
    const invReg  = normalizeDigits(invoice.supplierRegistration);
    const invName = normalizeName(invoice.vendorName);

    for (const comp of receivers) {
        const cVat  = normalizeId(comp.vat);
        const cReg  = normalizeDigits(comp.regCode);
        const cName = normalizeName(comp.name);

        if (cVat)  result.buyerVatSet.add(cVat);
        if (cReg)  result.buyerRegSet.add(cReg);
        if (cName) result.buyerNameSet.add(cName);

        // VAT leak: direct match, or the VAT string ENDS with the receiver
        // reg code. Some accounting systems stamp the buyer's VAT as
        // "EE<regCode>" — that's how we catch those.
        const vatLeak = (cVat && invVat && cVat === invVat)
                     || (cReg && invVat && invVat.endsWith(cReg));

        const regLeak = cReg && invReg && cReg === invReg;

        // Name leak: exact match, or either side contains the other (and both
        // have enough chars that substring matching isn't nonsense).
        let nameLeak = false;
        if (cName && invName && invName.length >= NAME_MIN_LEN) {
            if (cName === invName) nameLeak = true;
            else if (cName.length >= NAME_MIN_LEN) {
                if (invName.includes(cName) || cName.includes(invName)) nameLeak = true;
            }
        }

        if (vatLeak || regLeak || nameLeak) {
            result.leaked = true;
            if (vatLeak)  result.vatLeak  = true;
            if (regLeak)  result.regLeak  = true;
            if (nameLeak) result.nameLeak = true;
            if (!result.matchedCompanyName) result.matchedCompanyName = comp.name;
            // Don't break — we still need to finish populating the buyer sets
            // so re-extraction logic can skip every buyer identifier, not just
            // the one that triggered.
        }
    }

    return result;
}

/**
 * Clear leaked buyer fields in-place and return a list of correction strings
 * describing what was cleared. Does NOT attempt re-extraction — that's a
 * separate step the caller runs if rawText is available.
 *
 * @param {object} invoice — mutated in place
 * @param {ReturnType<inspectVendorFields>} report
 * @returns {string[]}  human-readable corrections (push onto corrections[])
 */
function clearLeakedFields(invoice, report) {
    const corrections = [];
    if (!report.leaked) return corrections;
    const who = report.matchedCompanyName || 'a registered receiver';

    if (report.vatLeak && invoice.supplierVat) {
        corrections.push(`Self-invoice guard: cleared buyer VAT "${invoice.supplierVat}" (belongs to ${who})`);
        invoice.supplierVat = '';
    }
    if (report.regLeak && invoice.supplierRegistration) {
        corrections.push(`Self-invoice guard: cleared buyer Reg "${invoice.supplierRegistration}" (belongs to ${who})`);
        invoice.supplierRegistration = '';
    }
    if (report.nameLeak && invoice.vendorName) {
        corrections.push(`Self-invoice guard: cleared buyer name "${invoice.vendorName}" (matches ${who})`);
        invoice.vendorName = '';
    }
    return corrections;
}

/**
 * Attempt to re-extract missing supplier data from rawText, skipping any
 * identifier that still belongs to a registered buyer.
 *
 * @param {object} invoice — mutated in place (only empty fields are filled)
 * @param {string} rawText
 * @param {ReturnType<inspectVendorFields>} report
 * @returns {string[]} corrections describing what was re-extracted
 */
function reextractSupplierFromText(invoice, rawText, report) {
    const corrections = [];
    if (!rawText) return corrections;

    // supplierRegistration
    if (report.regLeak && (!invoice.supplierRegistration || invoice.supplierRegistration === '')) {
        const re = /(?:Reg\.?\s*(?:nr|code|kood)|Rg-?kood)[.:\s]+(\d{6,10})/gi;
        for (const m of rawText.matchAll(re)) {
            if (!report.buyerRegSet.has(m[1])) {
                invoice.supplierRegistration = m[1];
                corrections.push(`Self-invoice guard: found supplier Reg ${m[1]} in text`);
                break;
            }
        }
    }

    // supplierVat
    if (report.vatLeak && (!invoice.supplierVat || invoice.supplierVat === '')) {
        const re = /(?:KMKR|KMKN|VAT)[.\s:]*([A-Z]{2}\d{6,12})/gi;
        for (const m of rawText.matchAll(re)) {
            const clean = normalizeId(m[1]);
            if (!report.buyerVatSet.has(clean)) {
                invoice.supplierVat = m[1];
                corrections.push(`Self-invoice guard: found supplier VAT ${m[1]} in text`);
                break;
            }
        }
    }

    // vendorName — first "reasonable" line of the document that isn't a buyer
    if (report.nameLeak && (!invoice.vendorName || invoice.vendorName === '')) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
        for (const line of lines) {
            const lineLower = normalizeName(line);
            if (!lineLower) continue;
            if (report.buyerNameSet.has(lineLower)) continue;
            // Skip noise: dates, invoice keywords, bank names, addresses
            if (/^\d|^arve|^kuup|^maks|^viitenumber|^swedbank|^seb|^lhv/i.test(line)) continue;
            if (line.length > 80) continue;
            invoice.vendorName = line;
            corrections.push(`Self-invoice guard: found supplier name "${line}" in text`);
            break;
        }
    }

    return corrections;
}

/**
 * End-to-end convenience: inspect → clear → re-extract. Returns:
 *   { leaked, corrections, report }
 *
 * @param {object} invoice
 * @param {Array}  receivers — [{name, vat, regCode}]
 * @param {string} rawText   — optional; when present, re-extraction runs too
 */
function applySelfInvoiceGuard(invoice, receivers, rawText = '') {
    const report = inspectVendorFields(invoice, receivers);
    if (!report.leaked) {
        return { leaked: false, corrections: [], report };
    }
    const corrections = [];
    corrections.push(...clearLeakedFields(invoice, report));
    if (rawText) {
        corrections.push(...reextractSupplierFromText(invoice, rawText, report));
    }
    return { leaked: true, corrections, report };
}

module.exports = {
    inspectVendorFields,
    clearLeakedFields,
    reextractSupplierFromText,
    applySelfInvoiceGuard,
    normalizeName,
    normalizeId,
    normalizeDigits,
};
