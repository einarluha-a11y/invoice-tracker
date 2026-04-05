#!/usr/bin/env node
/**
 * Unit tests for reconcile_rules.cjs.
 * Real-world cases from false Paid incidents (2026-04-05).
 *
 * Run: node automation/tests/reconcile.test.cjs
 */

const assert = require('assert');
const {
    matchReference,
    vendorOverlap,
    matchAmount,
    canReconcile,
} = require('../core/reconcile_rules.cjs');

let passed = 0;
let failed = 0;

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

console.log('\n── matchReference ──');

t('exact match case-insensitive', () => {
    assert.strictEqual(matchReference('PL21-25', 'pl21-25'), 'exact');
});

t('exact match ignoring separators', () => {
    assert.strictEqual(matchReference('pl21-25', 'PL2125'), 'exact');
});

t('PRONTO pl21-28 vs PL21-25 → no match (real false positive case)', () => {
    assert.strictEqual(matchReference('pl21-28', 'PL21-25'), false);
});

t('NUNNER diff invoice ids → no match (real false positive case)', () => {
    assert.strictEqual(matchReference('26/4211005197', '25/4211016350'), false);
});

t('B03494 contained in Allstore reference → strong', () => {
    assert.ok(matchReference('B03494', 'PMT-B03494-2026'));
});

t('short strings (<5 chars) → no strong match', () => {
    assert.strictEqual(matchReference('inv1', 'INV1-2026'), false);
});

t('empty input → false', () => {
    assert.strictEqual(matchReference('', 'anything'), false);
    assert.strictEqual(matchReference('anything', null), false);
});

console.log('\n── vendorOverlap ──');

t('FFC LOGISTICS vs Nunner Logistics → false (logistics is stopword)', () => {
    assert.strictEqual(vendorOverlap('FFC LOGISTICS', 'Nunner Logistics'), false);
});

t('PRONTO LOGISTYKA vs Pronto Logistyka Sp. z o.o. → true', () => {
    assert.strictEqual(vendorOverlap('PRONTO LOGISTYKA', 'Pronto Logistyka Sp. z o.o.'), true);
});

t('Allstore Assets vs ALLSTORE → true', () => {
    assert.strictEqual(vendorOverlap('Allstore Assets OÜ', 'ALLSTORE'), true);
});

t('vendorName with \\n and city → strips correctly', () => {
    assert.strictEqual(vendorOverlap('FFC LOGISTICS\nKOHTLA-JÄRVE', 'FFC Transport'), true);
});

t('empty vendor → false (conservative)', () => {
    assert.strictEqual(vendorOverlap('', 'Something'), false);
    assert.strictEqual(vendorOverlap('Something', ''), false);
});

t('only stopwords → false (no significant tokens)', () => {
    assert.strictEqual(vendorOverlap('Global Services', 'International Solutions'), false);
});

console.log('\n── matchAmount ──');

t('exact amount match', () => {
    assert.strictEqual(matchAmount(3600, 3600), 'full');
});

t('within 0.05 tolerance → full', () => {
    assert.strictEqual(matchAmount(3600.03, 3600), 'full');
});

t('tx less than invoice → partial', () => {
    assert.strictEqual(matchAmount(3600, 1000), 'partial');
});

t('tx greater than invoice → false', () => {
    assert.strictEqual(matchAmount(3600, 5000), false);
});

t('invalid input → false', () => {
    assert.strictEqual(matchAmount('abc', 100), false);
    assert.strictEqual(matchAmount(0, 100), false);
});

console.log('\n── canReconcile (composition) ──');

t('real PRONTO false match → rejected', () => {
    const result = canReconcile(
        { invoiceId: 'pl21-28', vendorName: 'PRONTO LOGISTYKA', amount: 3600 },
        { reference: 'PL21-25', counterparty: 'Pronto Logistyka', amount: 3600, matchedInvoiceId: null }
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'reference mismatch');
});

t('real FFC vs NUNNER cross-vendor → rejected', () => {
    const result = canReconcile(
        { invoiceId: '260305', vendorName: 'FFC LOGISTICS', amount: 5750 },
        { reference: '26/4211003536', counterparty: 'Nunner Logistics', amount: 5750, matchedInvoiceId: null }
    );
    assert.strictEqual(result.ok, false);
});

t('already matched tx → rejected (idempotency)', () => {
    const result = canReconcile(
        { invoiceId: 'pl21-25', vendorName: 'PRONTO', amount: 3600 },
        { reference: 'pl21-25', counterparty: 'PRONTO', amount: 3600, matchedInvoiceId: 'some-other-id' }
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'tx already matched');
});

t('valid match → ok', () => {
    const result = canReconcile(
        { invoiceId: 'pl21-25', vendorName: 'PRONTO LOGISTYKA', amount: 3600 },
        { reference: 'PL21-25', counterparty: 'Pronto Logistyka Sp. z o.o.', amount: 3600, matchedInvoiceId: null }
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.kind, 'exact');
    assert.strictEqual(result.payment, 'full');
});

t('valid partial payment → ok', () => {
    const result = canReconcile(
        { invoiceId: 'NUIA-001', vendorName: 'Nuia OÜ', amount: 5000 },
        { reference: 'NUIA-001', counterparty: 'NUIA', amount: 2000, matchedInvoiceId: null }
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.payment, 'partial');
});

console.log(`\n─── ${passed} passed, ${failed} failed ───\n`);
process.exit(failed > 0 ? 1 : 0);
