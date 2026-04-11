#!/usr/bin/env node
/**
 * Unit tests for core/bank_dedup.cjs (M7).
 * Run: node automation/tests/bank_dedup.test.cjs
 */

const assert = require('assert');
const { buildTxKey, buildContentHash, normalizeField } = require('../core/bank_dedup.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

// ─── Legacy buildTxKey (SHA-1 of normalized fields) ────────────────────────
console.log('\n── buildTxKey (legacy SHA-1, backward compat) ──');

t('same input → same key', () => {
    const tx = { companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'INV-1', counterparty: 'Acme' };
    assert.strictEqual(buildTxKey(tx), buildTxKey(tx));
});

t('different amount → different key', () => {
    const a = { companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'INV-1', counterparty: 'Acme' };
    const b = { ...a, amount: 200 };
    assert.notStrictEqual(buildTxKey(a), buildTxKey(b));
});

t('returns 40-char hex (SHA-1)', () => {
    const k = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: 100 });
    assert.strictEqual(k.length, 40);
    assert.ok(/^[0-9a-f]+$/.test(k));
});

t('handles date format normalization (DD.MM.YYYY === YYYY-MM-DD)', () => {
    const a = buildTxKey({ companyId: 'co1', date: '10.04.2026', amount: 100, reference: 'X', counterparty: 'Y' });
    const b = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'X', counterparty: 'Y' });
    assert.strictEqual(a, b);
});

t('handles amount format normalization (100 === "100" === "100.00")', () => {
    const a = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'X', counterparty: 'Y' });
    const b = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: '100', reference: 'X', counterparty: 'Y' });
    const c = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: '100.00', reference: 'X', counterparty: 'Y' });
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
});

t('case-insensitive on counterparty', () => {
    const a = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'X', counterparty: 'ACME' });
    const b = buildTxKey({ companyId: 'co1', date: '2026-04-10', amount: 100, reference: 'X', counterparty: 'acme' });
    assert.strictEqual(a, b);
});

// ─── buildContentHash (SHA-256 of raw input) ───────────────────────────────
console.log('\n── buildContentHash (M7 SHA-256) ──');

t('returns 64-char hex (SHA-256)', () => {
    const h = buildContentHash({ a: 1, b: 2 });
    assert.strictEqual(h.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(h));
});

t('same input → same hash', () => {
    const tx = { companyId: 'co1', date: '2026-04-10', amount: 100 };
    assert.strictEqual(buildContentHash(tx), buildContentHash(tx));
});

t('field order does not matter (sorted keys)', () => {
    const a = buildContentHash({ companyId: 'co1', date: '2026-04-10', amount: 100 });
    const b = buildContentHash({ amount: 100, date: '2026-04-10', companyId: 'co1' });
    assert.strictEqual(a, b);
});

t('underscore-prefixed fields are excluded', () => {
    const a = buildContentHash({ companyId: 'co1', amount: 100 });
    const b = buildContentHash({ companyId: 'co1', amount: 100, _internal: 'test', _ts: 12345 });
    assert.strictEqual(a, b);
});

t('null/undefined fields are excluded', () => {
    const a = buildContentHash({ companyId: 'co1', amount: 100 });
    const b = buildContentHash({ companyId: 'co1', amount: 100, reference: null, foo: undefined });
    assert.strictEqual(a, b);
});

t('different values → different hash', () => {
    const a = buildContentHash({ companyId: 'co1', amount: 100 });
    const b = buildContentHash({ companyId: 'co1', amount: 101 });
    assert.notStrictEqual(a, b);
});

t('contentHash IS sensitive to date format (intentional)', () => {
    // Unlike legacy txKey which normalizes dates, content hash hashes raw.
    // This is intentional — content hash protects against legacy
    // normalization drift; it should NOT itself normalize.
    const a = buildContentHash({ date: '2026-04-10' });
    const b = buildContentHash({ date: '10.04.2026' });
    assert.notStrictEqual(a, b);
});

t('handles nested objects via JSON.stringify', () => {
    const h = buildContentHash({ companyId: 'co1', metadata: { source: 'csv', line: 42 } });
    assert.ok(typeof h === 'string' && h.length === 64);
});

// ─── normalizeField direct tests ───────────────────────────────────────────
console.log('\n── normalizeField (regression coverage) ──');

t('null/undefined/empty string → __empty__', () => {
    assert.strictEqual(normalizeField('reference', null), '__empty__');
    assert.strictEqual(normalizeField('reference', undefined), '__empty__');
    assert.strictEqual(normalizeField('reference', ''), '__empty__');
});

t('amount uses cleanNum + 2-decimal', () => {
    assert.strictEqual(normalizeField('amount', '1.234,56'), '1234.56');
    assert.strictEqual(normalizeField('amount', 100), '100.00');
});

t('date DD.MM.YYYY → YYYY-MM-DD', () => {
    assert.strictEqual(normalizeField('date', '05.03.2026'), '2026-03-05');
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
