#!/usr/bin/env node
/**
 * Unit tests for core/env_check.cjs.
 * Run: node automation/tests/env_check.test.cjs
 */

const assert = require('assert');
const { checkEnv, REQUIRED_FOR } = require('../core/env_check.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── checkEnv ──');

t('all present → ok:true', () => {
    const saved = { A: process.env.A, B: process.env.B };
    process.env.A = 'foo';
    process.env.B = 'bar';
    const r = checkEnv([['A', 'desc A'], ['B', 'desc B']]);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.present, ['A', 'B']);
    process.env.A = saved.A || '';
    process.env.B = saved.B || '';
});

t('one missing → ok:false, lists it', () => {
    const saved = process.env.TEST_A;
    delete process.env.TEST_A;
    const r = checkEnv([['TEST_A', 'desc']]);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.missing, ['TEST_A']);
    if (saved) process.env.TEST_A = saved;
});

t('empty string counts as missing', () => {
    process.env.TEST_EMPTY = '';
    const r = checkEnv([['TEST_EMPTY', 'desc']]);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.missing, ['TEST_EMPTY']);
    delete process.env.TEST_EMPTY;
});

t('whitespace-only counts as missing', () => {
    process.env.TEST_WS = '   ';
    const r = checkEnv([['TEST_WS', 'desc']]);
    assert.strictEqual(r.ok, false);
    delete process.env.TEST_WS;
});

t('mixed present/missing', () => {
    process.env.TEST_YES = 'v';
    delete process.env.TEST_NO;
    const r = checkEnv([['TEST_YES', 'a'], ['TEST_NO', 'b']]);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.missing, ['TEST_NO']);
    assert.deepStrictEqual(r.present, ['TEST_YES']);
    delete process.env.TEST_YES;
});

console.log('\n── REQUIRED_FOR registry ──');

t('has imap_daemon', () => {
    assert.ok(Array.isArray(REQUIRED_FOR.imap_daemon));
    assert.ok(REQUIRED_FOR.imap_daemon.length > 0);
});

t('has api_server, repairman, bank_processor', () => {
    assert.ok(REQUIRED_FOR.api_server);
    assert.ok(REQUIRED_FOR.repairman);
    assert.ok(REQUIRED_FOR.bank_processor);
});

t('has frontend_build with VITE_FIREBASE_* vars', () => {
    const fb = REQUIRED_FOR.frontend_build;
    assert.ok(fb);
    const names = fb.map(([n]) => n);
    assert.ok(names.includes('VITE_FIREBASE_API_KEY'));
    assert.ok(names.includes('VITE_FIREBASE_PROJECT_ID'));
});

t('each entry is [name, description] tuple', () => {
    for (const [component, list] of Object.entries(REQUIRED_FOR)) {
        assert.ok(Array.isArray(list), `${component} should be an array`);
        for (const item of list) {
            assert.ok(Array.isArray(item) && item.length === 2, `${component} item not [name,desc]`);
            assert.ok(typeof item[0] === 'string' && item[0].length > 0);
            assert.ok(typeof item[1] === 'string' && item[1].length > 0);
        }
    }
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
