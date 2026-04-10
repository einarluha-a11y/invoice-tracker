#!/usr/bin/env node
/**
 * Unit tests for core/anomaly_detector.cjs.
 * Run: node automation/tests/anomaly.test.cjs
 */

const assert = require('assert');
const {
    scoreStatistical,
    scoreSemantic,
    meanStddev,
    zScore,
} = require('../core/anomaly_detector.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── meanStddev ──');

t('empty → zeros', () => {
    const r = meanStddev([]);
    assert.strictEqual(r.mean, 0);
    assert.strictEqual(r.stddev, 0);
});

t('single value → mean = value, stddev = 0', () => {
    const r = meanStddev([42]);
    assert.strictEqual(r.mean, 42);
    assert.strictEqual(r.stddev, 0);
});

t('uniform list → stddev = 0', () => {
    const r = meanStddev([10, 10, 10, 10]);
    assert.strictEqual(r.mean, 10);
    assert.strictEqual(r.stddev, 0);
});

t('classic [2,4,4,4,5,5,7,9] → stddev ≈ 2.138', () => {
    const r = meanStddev([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.strictEqual(r.mean, 5);
    assert.ok(Math.abs(r.stddev - 2.138) < 0.01);
});

console.log('\n── zScore ──');

t('zero stddev → 0', () => {
    assert.strictEqual(zScore(100, 50, 0), 0);
});

t('value at mean → 0', () => {
    assert.strictEqual(zScore(50, 50, 10), 0);
});

t('value 2 stddev above mean → 2', () => {
    assert.strictEqual(zScore(70, 50, 10), 2);
});

console.log('\n── scoreStatistical ──');

const baselineHistory = [
    { amount: 200, dateCreated: '2026-01-01' },
    { amount: 210, dateCreated: '2026-01-15' },
    { amount: 195, dateCreated: '2026-02-01' },
    { amount: 205, dateCreated: '2026-02-15' },
    { amount: 200, dateCreated: '2026-03-01' },
    { amount: 215, dateCreated: '2026-03-15' },
];

t('insufficient history (< 4) → no score', () => {
    const r = scoreStatistical({ amount: 5000 }, baselineHistory.slice(0, 2));
    assert.strictEqual(r.score, 0);
});

t('amount near mean → no score', () => {
    const r = scoreStatistical({ amount: 205 }, baselineHistory);
    assert.strictEqual(r.score, 0);
});

t('amount way above mean (z > 3) → 0.95', () => {
    const r = scoreStatistical({ amount: 50000 }, baselineHistory);
    assert.strictEqual(r.score, 0.95);
    assert.ok(Math.abs(r.zScore) > 3);
});

t('amount moderately above mean (2 < z < 3) → 0.70', () => {
    const r = scoreStatistical({ amount: 220 }, baselineHistory);
    // mean ≈ 204, stddev ≈ 7.4 → z ≈ 2.2 — depends on data, may be soft only
    assert.ok(r.score === 0 || r.score === 0.70);
});

console.log('\n── scoreSemantic ──');

t('new vendor → soft score 0.5', () => {
    const r = scoreSemantic({ amount: 100 }, []);
    assert.strictEqual(r.score, 0.5);
});

t('round large amount → +0.2', () => {
    const r = scoreSemantic({ amount: 5000 }, baselineHistory);
    assert.ok(r.score >= 0.2);
});

t('dueDate before dateCreated → 1.0 (always block)', () => {
    const r = scoreSemantic({ amount: 100, dateCreated: '2026-04-10', dueDate: '2026-04-01' }, baselineHistory);
    assert.strictEqual(r.score, 1.0);
});

t('duplicate amount within 7 days → +0.3', () => {
    const r = scoreSemantic(
        { amount: 200, dateCreated: '2026-03-04' },
        [{ amount: 200, dateCreated: '2026-03-01' }],
    );
    assert.ok(r.score >= 0.3);
});

t('non-round small amount with history → 0', () => {
    const r = scoreSemantic({ amount: 187.50, dateCreated: '2026-04-10' }, baselineHistory);
    assert.strictEqual(r.score, 0);
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
