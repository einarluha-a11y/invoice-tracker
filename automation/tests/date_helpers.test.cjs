#!/usr/bin/env node
/**
 * Unit tests for core/date_helpers.cjs.
 * Run: node automation/tests/date_helpers.test.cjs
 */

const assert = require('assert');
const {
    isIsoDate,
    todayIso,
    toIsoDate,
    parseIsoDate,
    addDays,
    daysBetween,
    isBeforeToday,
    coerceToIso,
    extractYearMonth,
} = require('../core/date_helpers.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── isIsoDate ──');
t('"2026-04-10" → true', () => assert.strictEqual(isIsoDate('2026-04-10'), true));
t('"2026-4-10" → false (needs zero-pad)', () => assert.strictEqual(isIsoDate('2026-4-10'), false));
t('"10.04.2026" → false (wrong format)', () => assert.strictEqual(isIsoDate('10.04.2026'), false));
t('null → false', () => assert.strictEqual(isIsoDate(null), false));
t('number → false', () => assert.strictEqual(isIsoDate(20260410), false));

console.log('\n── todayIso ──');
t('returns YYYY-MM-DD shape', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayIso()));
});

console.log('\n── parseIsoDate + toIsoDate roundtrip ──');
t('2026-04-10 roundtrips', () => {
    const d = parseIsoDate('2026-04-10');
    assert.ok(d instanceof Date);
    assert.strictEqual(toIsoDate(d), '2026-04-10');
});
t('invalid date → null', () => assert.strictEqual(parseIsoDate('not-a-date'), null));
t('empty → null', () => assert.strictEqual(parseIsoDate(''), null));

console.log('\n── addDays ──');
t('add 10 days to 2026-04-10 → 2026-04-20', () => {
    assert.strictEqual(addDays('2026-04-10', 10), '2026-04-20');
});
t('add 30 days across month boundary', () => {
    assert.strictEqual(addDays('2026-04-10', 30), '2026-05-10');
});
t('subtract 5 days', () => {
    assert.strictEqual(addDays('2026-04-10', -5), '2026-04-05');
});
t('DST-safe: March 2026 crossing spring forward (EU)', () => {
    // EU DST starts last Sunday of March. In 2026 that's March 29.
    // Naive +7days via timestamp math gets off by 1 hour if local TZ
    // observes DST; setUTCDate is immune.
    assert.strictEqual(addDays('2026-03-27', 7), '2026-04-03');
});
t('year boundary: Dec 31 + 1', () => {
    assert.strictEqual(addDays('2025-12-31', 1), '2026-01-01');
});
t('invalid input → null', () => {
    assert.strictEqual(addDays('not-a-date', 10), null);
});

console.log('\n── daysBetween ──');
t('same day → 0', () => {
    assert.strictEqual(daysBetween('2026-04-10', '2026-04-10'), 0);
});
t('a → b forward 10 days', () => {
    assert.strictEqual(daysBetween('2026-04-10', '2026-04-20'), 10);
});
t('a → b backward -5 days', () => {
    assert.strictEqual(daysBetween('2026-04-10', '2026-04-05'), -5);
});
t('across month boundary', () => {
    assert.strictEqual(daysBetween('2026-04-28', '2026-05-05'), 7);
});
t('invalid returns null', () => {
    assert.strictEqual(daysBetween('garbage', '2026-04-10'), null);
});

console.log('\n── isBeforeToday ──');
t('far-past date → true', () => {
    assert.strictEqual(isBeforeToday('2020-01-01'), true);
});
t('empty string → false', () => {
    assert.strictEqual(isBeforeToday(''), false);
});
t('null → false', () => {
    assert.strictEqual(isBeforeToday(null), false);
});

console.log('\n── coerceToIso (5 formats) ──');
t('ISO passthrough', () => {
    assert.strictEqual(coerceToIso('2026-04-10'), '2026-04-10');
});
t('DD.MM.YYYY → ISO', () => {
    assert.strictEqual(coerceToIso('10.04.2026'), '2026-04-10');
});
t('DD/MM/YYYY → ISO', () => {
    assert.strictEqual(coerceToIso('10/04/2026'), '2026-04-10');
});
t('DD-MM-YYYY → ISO', () => {
    assert.strictEqual(coerceToIso('10-04-2026'), '2026-04-10');
});
t('YYYY/MM/DD → ISO', () => {
    assert.strictEqual(coerceToIso('2026/04/10'), '2026-04-10');
});
t('2-digit year "10.04.26" → 2026-04-10', () => {
    assert.strictEqual(coerceToIso('10.04.26'), '2026-04-10');
});
t('unknown format → passthrough', () => {
    assert.strictEqual(coerceToIso('Apr 10, 2026'), 'Apr 10, 2026');
});
t('null → empty string', () => {
    assert.strictEqual(coerceToIso(null), '');
});

console.log('\n── extractYearMonth ──');
t('ISO "2026-04-09" → {2026, 4}', () => {
    assert.deepStrictEqual(extractYearMonth('2026-04-09'), { year: '2026', month: '4' });
});
t('European "09.04.2026" → {2026, 4}', () => {
    assert.deepStrictEqual(extractYearMonth('09.04.2026'), { year: '2026', month: '4' });
});
t('UK "09/04/2026" → {2026, 4}', () => {
    assert.deepStrictEqual(extractYearMonth('09/04/2026'), { year: '2026', month: '4' });
});
t('ISO January → month "1" (single digit)', () => {
    assert.deepStrictEqual(extractYearMonth('2026-01-15'), { year: '2026', month: '1' });
});
t('ISO December → month "12"', () => {
    assert.deepStrictEqual(extractYearMonth('2026-12-31'), { year: '2026', month: '12' });
});
t('empty string → today', () => {
    const now = new Date();
    const r = extractYearMonth('');
    assert.strictEqual(r.year, String(now.getUTCFullYear()));
    assert.strictEqual(r.month, String(now.getUTCMonth() + 1));
});
t('null → today', () => {
    const now = new Date();
    const r = extractYearMonth(null);
    assert.strictEqual(r.year, String(now.getUTCFullYear()));
});
t('undefined → today', () => {
    const now = new Date();
    const r = extractYearMonth(undefined);
    assert.strictEqual(r.year, String(now.getUTCFullYear()));
});
t('garbage "2026" (year only) → today (no false month=1)', () => {
    // This is the bug the audit caught: "2026" alone used to silently
    // become month="1". extractYearMonth refuses to guess.
    const now = new Date();
    const r = extractYearMonth('2026');
    assert.strictEqual(r.year, String(now.getUTCFullYear()));
    assert.strictEqual(r.month, String(now.getUTCMonth() + 1));
});
t('garbage "not a date" → today', () => {
    const now = new Date();
    const r = extractYearMonth('not a date');
    assert.strictEqual(r.year, String(now.getUTCFullYear()));
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
