#!/usr/bin/env node
/**
 * Unit tests for cleanNum (core/utils.cjs).
 * Critical: parseFloat fails silently on European formats like "1.200,50" (returns 1.2).
 * cleanNum must correctly parse both European and US decimal formats.
 *
 * Run: node automation/tests/cleannum.test.cjs
 */

const assert = require('assert');
const { cleanNum } = require('../core/utils.cjs');

let passed = 0, failed = 0;

function t(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

console.log('\n── cleanNum ──');

// European format (most common in EU invoices)
t('European "1.200,50" → 1200.50', () => {
    assert.strictEqual(cleanNum('1.200,50'), 1200.50);
});

t('European "1200,50" → 1200.50', () => {
    assert.strictEqual(cleanNum('1200,50'), 1200.50);
});

t('European "12.345.678,90" → 12345678.90', () => {
    assert.strictEqual(cleanNum('12.345.678,90'), 12345678.90);
});

// US format
t('US "1,200.50" → 1200.50', () => {
    assert.strictEqual(cleanNum('1,200.50'), 1200.50);
});

t('US "1,234,567.89" → 1234567.89', () => {
    assert.strictEqual(cleanNum('1,234,567.89'), 1234567.89);
});

// Simple
t('plain "500" → 500', () => {
    assert.strictEqual(cleanNum('500'), 500);
});

t('plain "500.50" → 500.50', () => {
    assert.strictEqual(cleanNum('500.50'), 500.50);
});

t('plain "500,50" → 500.50 (European interpretation)', () => {
    assert.strictEqual(cleanNum('500,50'), 500.50);
});

// Currency prefixes
t('"€500.50" → 500.50', () => {
    assert.strictEqual(cleanNum('€500.50'), 500.50);
});

t('"$ 1,200.50" → 1200.50', () => {
    assert.strictEqual(cleanNum('$ 1,200.50'), 1200.50);
});

t('"1.200,50 EUR" → 1200.50', () => {
    assert.strictEqual(cleanNum('1.200,50 EUR'), 1200.50);
});

// Numeric input
t('number 500.50 → 500.50', () => {
    assert.strictEqual(cleanNum(500.50), 500.50);
});

t('number 0 → 0', () => {
    assert.strictEqual(cleanNum(0), 0);
});

// Edge cases
t('null → 0', () => {
    assert.strictEqual(cleanNum(null), 0);
});

t('undefined → 0', () => {
    assert.strictEqual(cleanNum(undefined), 0);
});

t('empty string → 0', () => {
    assert.strictEqual(cleanNum(''), 0);
});

t('whitespace → 0', () => {
    assert.strictEqual(cleanNum('   '), 0);
});

t('non-numeric "abc" → 0', () => {
    assert.strictEqual(cleanNum('abc'), 0);
});

// Negative (bank statements use negative for outgoing)
t('negative "-500.50" → -500.50', () => {
    assert.strictEqual(cleanNum('-500.50'), -500.50);
});

t('negative "-1.200,50" → -1200.50', () => {
    assert.strictEqual(cleanNum('-1.200,50'), -1200.50);
});

// The failing case that parseFloat silently wrecks
t('CRITICAL: parseFloat returns 1.2 on "1.200,50", cleanNum returns 1200.50', () => {
    // Demonstrate parseFloat would be wrong
    assert.strictEqual(parseFloat('1.200,50'), 1.2);
    // cleanNum is correct
    assert.strictEqual(cleanNum('1.200,50'), 1200.50);
});

// ─── M9: 15 invoice number formats ───────────────────────────────────────────
console.log('\n── M9: extended invoice number formats ──');

// 1-8 already covered above. New formats:

// 9. Parens negative (accounting convention)
t('M9 parens negative "(1234.56)" → -1234.56', () => {
    assert.strictEqual(cleanNum('(1234.56)'), -1234.56);
});
t('M9 parens negative with currency "($1,234.56)" → -1234.56', () => {
    assert.strictEqual(cleanNum('($1,234.56)'), -1234.56);
});
t('M9 parens negative European "(1.234,56)" → -1234.56', () => {
    assert.strictEqual(cleanNum('(1.234,56)'), -1234.56);
});

// 10. Trailing minus (German/Polish ledger exports)
t('M9 trailing minus "1234.56-" → -1234.56', () => {
    assert.strictEqual(cleanNum('1234.56-'), -1234.56);
});
t('M9 trailing minus European "1.234,56-" → -1234.56', () => {
    assert.strictEqual(cleanNum('1.234,56-'), -1234.56);
});
t('M9 trailing minus does NOT misfire on "5-10" range', () => {
    // "5-10" looks like a range, not a number — cleanNum gets a string with - in middle
    // This will produce digit garbage; we just want it to not crash
    const r = cleanNum('5-10');
    assert.ok(typeof r === 'number' && isFinite(r));
});

// 11. Polish/CZ/RU non-breaking thousands space
t('M9 PL space-separated "1 234,56" → 1234.56', () => {
    assert.strictEqual(cleanNum('1 234,56'), 1234.56);
});
t('M9 PL space-separated "1 234 567,89" → 1234567.89', () => {
    assert.strictEqual(cleanNum('1 234 567,89'), 1234567.89);
});
t('M9 NBSP-separated "1\\u00A0234,56" → 1234.56', () => {
    assert.strictEqual(cleanNum('1\u00A0234,56'), 1234.56);
});

// 12. Swiss apostrophe
t("M9 Swiss apostrophe \"1'234.56\" → 1234.56", () => {
    assert.strictEqual(cleanNum("1'234.56"), 1234.56);
});
t("M9 Swiss apostrophe \"1'234'567.89\" → 1234567.89", () => {
    assert.strictEqual(cleanNum("1'234'567.89"), 1234567.89);
});

// 13. Indian (lakh/crore grouping)
t('M9 Indian "1,23,456.78" → 123456.78', () => {
    assert.strictEqual(cleanNum('1,23,456.78'), 123456.78);
});

// 14. Multiple thousand groups already covered ("12.345.678,90")

// 15. Just a separator
t('M9 just decimal ",50" → 0.50', () => {
    assert.strictEqual(cleanNum(',50'), 0.50);
});
t('M9 just decimal ".50" → 0.50', () => {
    assert.strictEqual(cleanNum('.50'), 0.50);
});

// Bonus: thousands disambiguation
t('M9 "1,000" (single comma + 3 digits) → 1000 not 1.0', () => {
    assert.strictEqual(cleanNum('1,000'), 1000);
});
t('M9 "1,50" (single comma + 2 digits) → 1.50', () => {
    assert.strictEqual(cleanNum('1,50'), 1.50);
});

// Real-world corner cases
t('M9 trailing dot "1234." → 1234', () => {
    assert.strictEqual(cleanNum('1234.'), 1234);
});
t('M9 mixed "Total: 1234.56 EUR" → 1234.56', () => {
    assert.strictEqual(cleanNum('Total: 1234.56 EUR'), 1234.56);
});
t('M9 leading + "+1234.56" → 1234.56', () => {
    assert.strictEqual(cleanNum('+1234.56'), 1234.56);
});

console.log(`\n─── ${passed} passed, ${failed} failed ───\n`);
process.exit(failed > 0 ? 1 : 0);
