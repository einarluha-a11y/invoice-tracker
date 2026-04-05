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

console.log(`\n─── ${passed} passed, ${failed} failed ───\n`);
process.exit(failed > 0 ? 1 : 0);
