#!/usr/bin/env node
/**
 * Unit tests for core/utils.cjs — isEmpty, computeContentHash.
 * (cleanNum has its own test file: cleannum.test.cjs)
 *
 * Run: node automation/tests/utils.test.cjs
 */

const assert = require('assert');
const { isEmpty, computeContentHash, cleanVendorName } = require('../core/utils.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── isEmpty ──');

t('null → true', () => assert.strictEqual(isEmpty(null), true));
t('undefined → true', () => assert.strictEqual(isEmpty(undefined), true));
t('empty string → true', () => assert.strictEqual(isEmpty(''), true));
t('whitespace-only "   " → true (B4 fix)', () => assert.strictEqual(isEmpty('   '), true));
t('tab+newline → true', () => assert.strictEqual(isEmpty('\t\n  \t'), true));
t('"Not_Found" → true', () => assert.strictEqual(isEmpty('Not_Found'), true));
t('"NOT_FOUND_ON_INVOICE" → true', () => assert.strictEqual(isEmpty('NOT_FOUND_ON_INVOICE'), true));
t('"Unknown Vendor" → true', () => assert.strictEqual(isEmpty('Unknown Vendor'), true));
t('"Auto-12345" → true (auto-generated id)', () => assert.strictEqual(isEmpty('Auto-12345'), true));
t('zero number → true', () => assert.strictEqual(isEmpty(0), true));
t('positive number → false', () => assert.strictEqual(isEmpty(42), false));
t('valid string → false', () => assert.strictEqual(isEmpty('Acme OÜ'), false));
t('whitespace-padded valid string → false', () => assert.strictEqual(isEmpty('  Acme OÜ  '), false));

console.log('\n── computeContentHash ──');

t('null → null', () => assert.strictEqual(computeContentHash(null), null));
t('same buffer → same hash', () => {
    const a = computeContentHash(Buffer.from('hello world'));
    const b = computeContentHash(Buffer.from('hello world'));
    assert.strictEqual(a, b);
});
t('different buffers → different hashes', () => {
    const a = computeContentHash(Buffer.from('hello world'));
    const b = computeContentHash(Buffer.from('hello world!'));
    assert.notStrictEqual(a, b);
});
t('hash is 64 hex chars', () => {
    const h = computeContentHash(Buffer.from('test'));
    assert.strictEqual(h.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(h));
});
t('accepts string input (auto-converts to buffer)', () => {
    const h = computeContentHash('hello');
    assert.strictEqual(h.length, 64);
});

console.log('\n── cleanVendorName ──');

t('strips straight quotes', () => assert.strictEqual(cleanVendorName('"Acme OÜ"'), 'Acme OÜ'));
t('strips guillemets « »', () => assert.strictEqual(cleanVendorName('«Acme OÜ»'), 'Acme OÜ'));
t('null → null', () => assert.strictEqual(cleanVendorName(null), null));

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
