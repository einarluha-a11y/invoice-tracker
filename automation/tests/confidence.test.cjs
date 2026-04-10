#!/usr/bin/env node
/**
 * Unit tests for core/confidence_scorer.cjs.
 * Run: node automation/tests/confidence.test.cjs
 */

const assert = require('assert');
const {
    extractConfidenceScores,
    classifyExtractionQuality,
    LOW_CONFIDENCE_THRESHOLD,
} = require('../core/confidence_scorer.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

// Build a minimal Azure-like document fixture
function makeDoc(fields) {
    return { fields };
}
function makeField(value, confidence) {
    return { value, confidence, content: String(value) };
}

console.log('\n── extractConfidenceScores ──');

t('empty doc returns zeros', () => {
    const r = extractConfidenceScores(null);
    assert.strictEqual(r.minFieldConfidence, 0);
    assert.strictEqual(r.avgConfidence, 0);
    assert.deepStrictEqual(r.lowConfidenceFields, []);
});

t('all-high doc → no low-confidence fields', () => {
    const doc = makeDoc({
        VendorName: makeField('Acme OÜ', 0.95),
        InvoiceId:  makeField('INV-1', 0.9),
        InvoiceTotal: makeField({ amount: 100 }, 0.99),
    });
    const r = extractConfidenceScores(doc);
    assert.deepStrictEqual(r.lowConfidenceFields, []);
    assert.ok(r.avgConfidence > 0.9);
    assert.ok(r.minFieldConfidence >= 0.9);
});

t('field below threshold appears in lowConfidenceFields', () => {
    const doc = makeDoc({
        VendorName: makeField('Acme OÜ', 0.95),
        DueDate: makeField('2026-04-30', 0.72),
    });
    const r = extractConfidenceScores(doc);
    assert.ok(r.lowConfidenceFields.includes('dueDate'));
    assert.ok(r.minFieldConfidence < LOW_CONFIDENCE_THRESHOLD);
});

t('empty fields are skipped', () => {
    const doc = makeDoc({
        VendorName: makeField('Acme OÜ', 0.95),
        InvoiceId:  makeField('', 0.4),  // empty value should NOT count
    });
    const r = extractConfidenceScores(doc);
    assert.strictEqual(Object.keys(r.confidenceScores).length, 1);
    assert.ok(!r.lowConfidenceFields.includes('invoiceId'));
});

console.log('\n── classifyExtractionQuality ──');

t('low when too few text lines', () => {
    const result = { pages: [{ lines: [{}, {}] }] }; // 2 lines
    const scores = { avgConfidence: 0.95, minFieldConfidence: 0.95 };
    assert.strictEqual(classifyExtractionQuality(result, scores), 'low');
});

t('low when avg confidence < 0.6', () => {
    const result = { pages: [{ lines: new Array(20).fill({}) }] };
    const scores = { avgConfidence: 0.5, minFieldConfidence: 0.5 };
    assert.strictEqual(classifyExtractionQuality(result, scores), 'low');
});

t('medium when avg < 0.85', () => {
    const result = { pages: [{ lines: new Array(20).fill({}) }] };
    const scores = { avgConfidence: 0.78, minFieldConfidence: 0.78 };
    assert.strictEqual(classifyExtractionQuality(result, scores), 'medium');
});

t('high when avg and min both >= threshold', () => {
    const result = { pages: [{ lines: new Array(30).fill({}) }] };
    const scores = { avgConfidence: 0.92, minFieldConfidence: 0.88 };
    assert.strictEqual(classifyExtractionQuality(result, scores), 'high');
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
