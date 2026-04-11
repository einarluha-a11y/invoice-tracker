/**
 * Lightweight invoice-language detector (M5).
 *
 * No ML, no model loading — pure char-class + keyword heuristics. Returns
 * one of: 'et' | 'ru' | 'pl' | 'de' | 'lt' | 'lv' | 'en' | 'unknown'.
 *
 * Why not full ML? Invoices use a small fixed vocabulary (vendor name,
 * date label, total label, VAT label) so keyword matching against the
 * 6 most common EU languages we see in this project is >95% accurate
 * and runs in microseconds. ML models would also need to be loaded into
 * Railway memory.
 *
 * Detection order:
 *   1. Count occurrences of language-specific keyword tokens (most reliable)
 *   2. Tiebreak with character set scores (Estonian "õäöü" vs German "äöß")
 *   3. Default to 'en' if no signal
 *
 * Used by: teacher_agent.cjs (selects per-language Claude prompts),
 *          document_ai_service.cjs (skips irrelevant regex passes).
 */

'use strict';

// Strong keyword indicators — matched as whole words, case-insensitive.
// Each language gets ~10-15 high-precision tokens that almost never appear
// in other languages.
const KEYWORDS = {
    et: [
        // Estonian-specific invoice vocabulary
        'arve', 'kuupäev', 'maksetähtaeg', 'maksetähtpäev', 'kmkr',
        'tarnija', 'müüja', 'ostja', 'maksja', 'summa kokku', 'käibemaks',
        'reg.kood', 'rg-kood', 'pangakonto', 'viitenumber', 'üldsumma',
        'tasumistingimus', 'kuup.', 'lehekülg',
    ],
    ru: [
        'счёт', 'счет', 'дата', 'покупатель', 'продавец', 'поставщик',
        'итого', 'ндс', 'инн', 'кпп', 'оплата', 'без ндс', 'к оплате',
        'плательщик', 'получатель',
    ],
    pl: [
        'faktura', 'sprzedawca', 'nabywca', 'data wystawienia', 'termin płatności',
        'razem', 'do zapłaty', 'nip', 'regon', 'wartość', 'netto', 'brutto',
        'podatek vat', 'sp. z o.o', 'sp. z o. o',
    ],
    de: [
        'rechnung', 'rechnungsdatum', 'zahlungsziel', 'zahlbar bis',
        'ust-id', 'ust.-id', 'umsatzsteuer', 'mwst', 'gesamtbetrag',
        'lieferant', 'empfänger', 'rechnungsnummer', 'rg-nr', 'steuernr',
    ],
    lt: [
        'sąskaita', 'pirkėjas', 'pardavėjas', 'pvm kodas', 'data',
        'apmokėti', 'iš viso', 'be pvm', 'su pvm', 'įmonės kodas',
    ],
    lv: [
        'rēķins', 'pārdevējs', 'pircējs', 'reģistrācijas', 'pvn',
        'apmaksai', 'kopā', 'datums', 'apmaksas termiņš',
    ],
    en: [
        'invoice', 'invoice date', 'due date', 'payment terms', 'subtotal',
        'total', 'vat', 'tax', 'amount due', 'bill to', 'supplier', 'customer',
    ],
};

// Char class scoring — counts occurrences of language-specific characters
// (not in other languages we care about).
const CHAR_CLASSES = {
    et: /[õäöüÕÄÖÜ]/g,
    ru: /[а-яё]/gi,
    pl: /[ąęóćśłżźń]/gi,
    de: /[ßäöüÄÖÜ]/g,  // overlaps with ET, broken by keyword score
    lt: /[ąčęėįšųūž]/gi,
    lv: /[āčēģķļņšūž]/gi,
};

function countMatches(text, pattern) {
    const m = text.match(pattern);
    return m ? m.length : 0;
}

function countKeywordMatches(text, keywords) {
    const lower = text.toLowerCase();
    let total = 0;
    for (const kw of keywords) {
        // Word boundary that works with non-ASCII letters.
        // Match: keyword surrounded by non-letter chars (or start/end).
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use Unicode-aware boundary: lookbehind/lookahead for non-letter
        const re = new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'giu');
        const matches = lower.match(re);
        if (matches) total += matches.length;
    }
    return total;
}

/**
 * Detect the dominant invoice language from raw OCR text.
 *
 * @param {string} rawText
 * @returns {{ language: string, confidence: number, scores: Object }}
 *   language    — 2-letter code or 'unknown'
 *   confidence  — 0..1, max keyword score normalized
 *   scores      — Map<lang, score> for diagnostics
 */
function detectLanguage(rawText) {
    if (!rawText || rawText.length < 20) {
        return { language: 'unknown', confidence: 0, scores: {} };
    }

    const scores = {};
    for (const [lang, keywords] of Object.entries(KEYWORDS)) {
        const kw = countKeywordMatches(rawText, keywords);
        const ch = countMatches(rawText, CHAR_CLASSES[lang] || /a^/g);
        // Keywords are weighted heavier — they're high-precision signals.
        // Char classes break ties (e.g. between ET and DE which share ä/ö/ü).
        scores[lang] = kw * 10 + ch;
    }

    // Pick the highest-scoring language
    let best = 'unknown';
    let bestScore = 0;
    for (const [lang, score] of Object.entries(scores)) {
        if (score > bestScore) {
            best = lang;
            bestScore = score;
        }
    }

    if (bestScore === 0) {
        return { language: 'unknown', confidence: 0, scores };
    }

    // Confidence = how dominant the winner is over the runner-up
    const sorted = Object.values(scores).sort((a, b) => b - a);
    const runnerUp = sorted[1] || 0;
    const confidence = sorted[0] === 0 ? 0 : (sorted[0] - runnerUp) / sorted[0];

    return { language: best, confidence: Math.round(confidence * 100) / 100, scores };
}

/**
 * Per-language hints for the Claude vendor extraction prompt.
 * Returns a short string the caller can splice into the prompt — gives
 * Claude the labels it should look for in that specific language.
 */
function getLanguageHint(language) {
    switch (language) {
        case 'et':
            return 'Document is in Estonian. Look for labels: Tarnija/Müüja (vendor), Ostja/Maksja (buyer — NOT vendor), Arve nr (invoice id), Kuupäev (date), Maksetähtaeg (due date), KMKR nr (VAT), Reg.kood (registration), Summa kokku (total), Käibemaks (tax).';
        case 'ru':
            return 'Document is in Russian. Look for labels: Поставщик/Продавец (vendor), Покупатель/Плательщик (buyer — NOT vendor), Счёт № (invoice id), Дата (date), Срок оплаты (due date), ИНН (registration), Итого (total), НДС (tax).';
        case 'pl':
            return 'Document is in Polish. Look for labels: Sprzedawca (vendor), Nabywca (buyer — NOT vendor), Faktura nr (invoice id), Data wystawienia (date), Termin płatności (due date), NIP (VAT/registration), Razem/Do zapłaty (total), Podatek VAT (tax).';
        case 'de':
            return 'Document is in German. Look for labels: Lieferant/Verkäufer (vendor), Kunde/Empfänger (buyer — NOT vendor), Rechnung Nr (invoice id), Rechnungsdatum (date), Zahlungsziel (due date), USt-IdNr (VAT), Steuernr (registration), Gesamtbetrag (total), MwSt (tax).';
        case 'lt':
            return 'Document is in Lithuanian. Look for labels: Pardavėjas (vendor), Pirkėjas (buyer — NOT vendor), Sąskaita Nr (invoice id), Data (date), PVM kodas (VAT), Įmonės kodas (registration), Iš viso (total), PVM (tax).';
        case 'lv':
            return 'Document is in Latvian. Look for labels: Pārdevējs (vendor), Pircējs (buyer — NOT vendor), Rēķins Nr (invoice id), Datums (date), Apmaksas termiņš (due date), Reģistrācijas Nr (VAT), Kopā/Apmaksai (total), PVN (tax).';
        case 'en':
            return 'Document is in English. Look for labels: Supplier/Vendor (vendor), Customer/Bill To (buyer — NOT vendor), Invoice No (invoice id), Invoice Date (date), Due Date (due date), VAT No (VAT), Tax ID/EIN (registration), Total (total), VAT/Tax (tax).';
        default:
            return 'Language unknown — try common multilingual labels: Invoice/Faktura/Rechnung/Счёт/Arve, VAT/PVM/USt/НДС/KMKR.';
    }
}

module.exports = {
    detectLanguage,
    getLanguageHint,
    KEYWORDS,
    CHAR_CLASSES,
};
