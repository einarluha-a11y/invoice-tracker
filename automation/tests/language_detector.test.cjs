#!/usr/bin/env node
/**
 * Unit tests for core/language_detector.cjs (M5).
 * Run: node automation/tests/language_detector.test.cjs
 */

const assert = require('assert');
const { detectLanguage, getLanguageHint } = require('../core/language_detector.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

// Real invoice text snippets — short but representative
const SNIPPETS = {
    et: `ANESTA OÜ
Müüja
ARVE Nr 26114
Kuupäev 09.04.2026
Tasumise kuupäev 09.05.2026
KMKR EE100047358
Reg.nr 10089633
Summa kokku 9672,00 EUR
Käibemaks 24% 1872,00`,

    ru: `Поставщик ООО «Ромашка»
Счёт № 12345
Дата 01.02.2026
Покупатель ИП Иванов
Итого к оплате 5000,00 руб
НДС 20% 833,33
ИНН 1234567890`,

    pl: `Sprzedawca: PRONTO LOGISTYKA Sp. z o.o.
Faktura VAT 2026/03/123
Data wystawienia 15.03.2026
Termin płatności 30.03.2026
NIP 1133099765
Razem do zapłaty 4920,00 PLN
Podatek VAT 23% 920,00`,

    de: `Lieferant: Würth AG
Rechnung Nr. 5123025269
Rechnungsdatum 30.01.2026
Zahlungsziel 28.02.2026
USt-IdNr DE349242045
Gesamtbetrag 152,33 EUR
MwSt 19% 24,33`,

    en: `Supplier: DeepL SE
Invoice No: INV-2026-001
Invoice Date: 2026-03-15
Due Date: 2026-04-15
VAT No: DE349242045
Subtotal: 24.19 EUR
VAT 24%: 5.80
Total: 29.99 EUR`,

    lt: `Pardavėjas: UAB Inovatus
Sąskaita Nr AL-25.12-16116
Data 23.12.2025
PVM kodas LT100018378612
Įmonės kodas 303331407
Iš viso 4900,00 EUR
PVM 0% 0,00`,
};

console.log('\n── detectLanguage on real invoice snippets ──');

for (const [expected, text] of Object.entries(SNIPPETS)) {
    t(`detects ${expected.toUpperCase()} from real invoice text`, () => {
        const r = detectLanguage(text);
        assert.strictEqual(r.language, expected,
            `expected ${expected}, got ${r.language} (scores: ${JSON.stringify(r.scores)})`);
    });
}

console.log('\n── edge cases ──');

t('empty text → unknown', () => {
    const r = detectLanguage('');
    assert.strictEqual(r.language, 'unknown');
});

t('null text → unknown', () => {
    const r = detectLanguage(null);
    assert.strictEqual(r.language, 'unknown');
});

t('text shorter than 20 chars → unknown', () => {
    const r = detectLanguage('hello');
    assert.strictEqual(r.language, 'unknown');
});

t('garbage text with no language signals → unknown', () => {
    const r = detectLanguage('1234567890 abc xyz qqq zzz mmm 999');
    assert.strictEqual(r.language, 'unknown');
});

t('confidence is between 0 and 1', () => {
    const r = detectLanguage(SNIPPETS.et);
    assert.ok(r.confidence >= 0 && r.confidence <= 1, `confidence=${r.confidence}`);
});

console.log('\n── getLanguageHint ──');

t('returns hint for each known language', () => {
    for (const lang of ['et', 'ru', 'pl', 'de', 'lt', 'lv', 'en']) {
        const hint = getLanguageHint(lang);
        assert.ok(typeof hint === 'string' && hint.length > 30, `hint for ${lang} is too short`);
    }
});

t('unknown language returns multilingual fallback hint', () => {
    const hint = getLanguageHint('unknown');
    assert.ok(hint.includes('multilingual') || hint.includes('common'), 'fallback should mention multilingual');
});

t('Estonian hint mentions KMKR + Tarnija + Käibemaks', () => {
    const hint = getLanguageHint('et');
    assert.ok(hint.includes('KMKR'));
    assert.ok(hint.includes('Tarnija') || hint.includes('Müüja'));
    assert.ok(hint.includes('Käibemaks'));
});

t('Polish hint mentions NIP + Sprzedawca + Faktura', () => {
    const hint = getLanguageHint('pl');
    assert.ok(hint.includes('NIP'));
    assert.ok(hint.includes('Sprzedawca'));
    assert.ok(hint.includes('Faktura'));
});

console.log('\n── disambiguation: ET vs DE (both share äöü) ──');

t('ET wins over DE when KMKR + Käibemaks present', () => {
    const r = detectLanguage(SNIPPETS.et);
    assert.strictEqual(r.language, 'et');
    assert.ok(r.scores.et > r.scores.de, `et=${r.scores.et} de=${r.scores.de}`);
});

t('DE wins over ET when Rechnung + USt-IdNr present', () => {
    const r = detectLanguage(SNIPPETS.de);
    assert.strictEqual(r.language, 'de');
    assert.ok(r.scores.de > r.scores.et, `de=${r.scores.de} et=${r.scores.et}`);
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
