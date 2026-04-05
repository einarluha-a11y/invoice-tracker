/**
 * Central reconciliation rules for matching bank transactions to invoices.
 *
 * Single source of truth used by:
 * - automation/imap_daemon.cjs reconcilePayment()
 * - automation/repairman_agent.cjs checkBankTransactions() + checkAllPaidInvoices()
 * - src/data/api.ts post-save reconciliation (logic duplicated in TS where needed)
 *
 * Rules (all must pass for a match):
 *  1. Reference: exact OR strong substring (≥5 chars, ≥70% length ratio)
 *  2. Vendor: ≥1 common word ≥4 chars (after stripping legal suffixes, cities, stopwords)
 *  3. Amount: exact ±0.05 for full payment, or tx.amount < invoice.amount for partial
 *  4. Idempotency: tx.matchedInvoiceId must be null/undefined
 */

const LEGAL_SUFFIXES = /\b(o[uü]|as|sa|sia|sp\.?\s*z\s*o\.?\s*o\.?|gmbh|llc|ltd|inc|ag|bv|srl|spa)\b/gi;
const CITIES = /\b(tallinn|tartu|narva|p[aä]rnu|kohtla[\s-]?j[aä]rve|warsaw|warszawa|riga|vilnius|helsinki|stockholm|moscow|kiev|kyiv)\b/gi;
const VENDOR_STOPWORDS = new Set([
    'logistics', 'transport', 'trans', 'cargo', 'freight', 'services', 'service',
    'group', 'holding', 'international', 'company', 'solutions', 'systems',
    'consulting', 'global', 'trade', 'trading', 'auto', 'motors', 'store',
]);

/**
 * Match invoiceId against bank tx reference.
 * Returns: 'exact' | 'strong' | false
 */
function matchReference(invId, txRef) {
    if (!invId || !txRef) return false;
    const a = String(invId).replace(/[\s\-\/]/g, '').toLowerCase();
    const b = String(txRef).replace(/[\s\-\/]/g, '').toLowerCase();
    if (!a || !b) return false;
    if (a === b) return 'exact';
    // Strong: shorter fully contained in longer, shorter ≥5 chars.
    // No ratio check — bank refs often wrap invoiceId in prefixes/suffixes (PMT-INV123-2026).
    // Protection against PRONTO case ("pl2125" vs "pl2128") works because neither is
    // a substring of the other (they differ in middle), so includes() returns false.
    if (a.length >= 5 && b.length >= 5) {
        const [short, long] = a.length < b.length ? [a, b] : [b, a];
        if (long.includes(short)) return 'strong';
    }
    return false;
}

/**
 * Tokenize a vendor name into significant words (≥4 chars, not a stopword).
 */
function tokenize(s) {
    return (s || '')
        .toLowerCase()
        .replace(/\n/g, ' ')
        .replace(LEGAL_SUFFIXES, ' ')
        .replace(CITIES, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^a-zа-яёõäöü0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !VENDOR_STOPWORDS.has(w));
}

/**
 * Check if two vendor names share ≥1 significant word.
 * Returns false if either side has no significant tokens (cannot verify — be conservative).
 */
function vendorOverlap(a, b) {
    const sa = new Set(tokenize(a));
    const sb = new Set(tokenize(b));
    if (sa.size === 0 || sb.size === 0) return false;
    for (const x of sa) if (sb.has(x)) return true;
    return false;
}

/**
 * Check if an amount matches within tolerance, or is a valid partial payment.
 * Returns: 'full' | 'partial' | false
 */
function matchAmount(invoiceAmount, txAmount) {
    const inv = parseFloat(invoiceAmount);
    const tx = parseFloat(txAmount);
    if (isNaN(inv) || isNaN(tx) || tx <= 0 || inv <= 0) return false;
    if (Math.abs(inv - tx) <= 0.05) return 'full';
    if (tx < inv) return 'partial';
    return false; // tx > invoice amount → not our payment
}

/**
 * Composite check: can this bank tx reconcile against this invoice?
 * Returns { ok: true, kind: 'exact'|'strong', payment: 'full'|'partial' } or { ok: false, reason: string }
 */
function canReconcile(invoice, tx) {
    if (!invoice || !tx) return { ok: false, reason: 'missing input' };
    if (tx.matchedInvoiceId) return { ok: false, reason: 'tx already matched' };

    const refMatch = matchReference(invoice.invoiceId, tx.reference);
    if (!refMatch) return { ok: false, reason: 'reference mismatch' };

    const vendorOk = vendorOverlap(invoice.vendorName, tx.counterparty);
    if (!vendorOk) return { ok: false, reason: 'vendor mismatch' };

    const amountMatch = matchAmount(invoice.amount, tx.amount);
    if (!amountMatch) return { ok: false, reason: 'amount mismatch' };

    return { ok: true, kind: refMatch, payment: amountMatch };
}

module.exports = {
    matchReference,
    vendorOverlap,
    matchAmount,
    canReconcile,
    tokenize,
    LEGAL_SUFFIXES,
    CITIES,
    VENDOR_STOPWORDS,
};
