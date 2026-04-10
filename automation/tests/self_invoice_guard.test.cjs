#!/usr/bin/env node
/**
 * Unit tests for core/self_invoice_guard.cjs.
 * Run: node automation/tests/self_invoice_guard.test.cjs
 */

const assert = require('assert');
const {
    inspectVendorFields,
    clearLeakedFields,
    applySelfInvoiceGuard,
} = require('../core/self_invoice_guard.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

const RECEIVERS = [
    { name: 'Global Technics OÜ', vat: 'EE101234567', regCode: '12345678' },
    { name: 'Ideacom OÜ',         vat: 'EE107654321', regCode: '87654321' },
];

console.log('\n── inspectVendorFields ──');

t('clean invoice → not leaked', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: 'EE100000000', supplierRegistration: '99999999' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.leaked, false);
});

t('VAT match → vatLeak', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: 'EE101234567', supplierRegistration: '99999999' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.leaked, true);
    assert.strictEqual(r.vatLeak, true);
    assert.strictEqual(r.matchedCompanyName, 'Global Technics OÜ');
});

t('regCode embedded in VAT → vatLeak', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: 'EE12345678', supplierRegistration: '' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.vatLeak, true);
});

t('regCode direct match → regLeak', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: '', supplierRegistration: '12345678' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.regLeak, true);
});

t('vendorName matches receiver → nameLeak', () => {
    const inv = { vendorName: 'Global Technics OÜ', supplierVat: '', supplierRegistration: '' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.nameLeak, true);
});

t('vendor name substring match', () => {
    const inv = { vendorName: 'Global Technics', supplierVat: '', supplierRegistration: '' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.nameLeak, true);
});

t('short ambiguous name → no false leak', () => {
    const inv = { vendorName: 'AS', supplierVat: '', supplierRegistration: '' };
    const r = inspectVendorFields(inv, RECEIVERS);
    assert.strictEqual(r.nameLeak, false);
});

console.log('\n── clearLeakedFields ──');

t('clears VAT in place', () => {
    const inv = { vendorName: 'X', supplierVat: 'EE101234567', supplierRegistration: '' };
    const report = inspectVendorFields(inv, RECEIVERS);
    clearLeakedFields(inv, report);
    assert.strictEqual(inv.supplierVat, '');
});

t('does not clear name when only VAT leaked', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: 'EE101234567', supplierRegistration: '' };
    const report = inspectVendorFields(inv, RECEIVERS);
    clearLeakedFields(inv, report);
    assert.strictEqual(inv.vendorName, 'Anesta OÜ');
});

console.log('\n── applySelfInvoiceGuard ──');

t('clean invoice → no corrections', () => {
    const inv = { vendorName: 'Anesta OÜ', supplierVat: 'EE100000000' };
    const r = applySelfInvoiceGuard(inv, RECEIVERS);
    assert.strictEqual(r.leaked, false);
    assert.strictEqual(r.corrections.length, 0);
});

t('end-to-end re-extraction from rawText finds non-buyer reg', () => {
    const inv = {
        vendorName: '',
        supplierVat: '',
        supplierRegistration: '12345678', // buyer's reg
    };
    const rawText = 'Reg.kood 99999999\nKMKR EE100000000\n';
    const r = applySelfInvoiceGuard(inv, RECEIVERS, rawText);
    assert.strictEqual(inv.supplierRegistration, '99999999');
    assert.ok(r.corrections.length > 0);
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
