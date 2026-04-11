#!/usr/bin/env node
/**
 * Unit tests for resolveDropboxConfig + buildDropboxFolderPath (M2).
 * Run: node automation/tests/dropbox_config.test.cjs
 */

const assert = require('assert');
const { resolveDropboxConfig, buildDropboxFolderPath } = require('../dropbox_service.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── resolveDropboxConfig — Firestore source ──');

t('uses Firestore dropboxConfig when present', () => {
    const r = resolveDropboxConfig('Random Co', {
        dropboxConfig: { folderBasePath: 'NEWCO', folderPrefix: 'NC' },
    });
    assert.strictEqual(r.folderBasePath, 'NEWCO');
    assert.strictEqual(r.folderPrefix, 'NC');
    assert.strictEqual(r.source, 'firestore');
});

t('Firestore config wins even if name matches IDEACOM', () => {
    const r = resolveDropboxConfig('IDEACOM OÜ', {
        dropboxConfig: { folderBasePath: 'CUSTOM', folderPrefix: 'CU' },
    });
    assert.strictEqual(r.folderBasePath, 'CUSTOM');
    assert.strictEqual(r.source, 'firestore');
});

t('partial Firestore config (missing prefix) → fall through to legacy', () => {
    const r = resolveDropboxConfig('IDEACOM OÜ', {
        dropboxConfig: { folderBasePath: 'CUSTOM' }, // no folderPrefix
    });
    assert.strictEqual(r.folderBasePath, 'IDEACOM');
    assert.strictEqual(r.source, 'legacy');
});

console.log('\n── resolveDropboxConfig — legacy heuristic ──');

t('IDEACOM detected from name (no Firestore config)', () => {
    const r = resolveDropboxConfig('IDEACOM OÜ', null);
    assert.strictEqual(r.folderBasePath, 'IDEACOM');
    assert.strictEqual(r.folderPrefix, 'IC');
    assert.strictEqual(r.source, 'legacy');
});

t('GLOBAL TECHNICS detected from name', () => {
    const r = resolveDropboxConfig('Global Technics OÜ', null);
    assert.strictEqual(r.folderBasePath, 'GLOBAL TECHNICS');
    assert.strictEqual(r.folderPrefix, 'GT');
    assert.strictEqual(r.source, 'legacy');
});

t('case insensitive match: "ideacom"', () => {
    const r = resolveDropboxConfig('ideacom oü', null);
    assert.strictEqual(r.folderBasePath, 'IDEACOM');
});

t('substring match: "Acme + IDEACOM" still hits IDEACOM', () => {
    const r = resolveDropboxConfig('Acme via IDEACOM', null);
    assert.strictEqual(r.folderBasePath, 'IDEACOM');
});

console.log('\n── resolveDropboxConfig — default fallback ──');

t('unknown company → UNKNOWN_COMPANY/UK', () => {
    const r = resolveDropboxConfig('Random Co OÜ', null);
    assert.strictEqual(r.folderBasePath, 'UNKNOWN_COMPANY');
    assert.strictEqual(r.folderPrefix, 'UK');
    assert.strictEqual(r.source, 'default');
});

t('null name → UNKNOWN', () => {
    const r = resolveDropboxConfig(null, null);
    assert.strictEqual(r.folderBasePath, 'UNKNOWN_COMPANY');
});

t('empty data object → UNKNOWN', () => {
    const r = resolveDropboxConfig('Random', {});
    assert.strictEqual(r.folderBasePath, 'UNKNOWN_COMPANY');
});

console.log('\n── buildDropboxFolderPath ──');

t('IDEACOM March 2026 path', () => {
    const path = buildDropboxFolderPath('IDEACOM OÜ', '2026', '3');
    assert.strictEqual(path, '/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3');
});

t('GLOBAL TECHNICS December 2025 path', () => {
    const path = buildDropboxFolderPath('Global Technics OÜ', '2025', '12');
    assert.strictEqual(path, '/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_2025/GT_arved_meile_2025_12');
});

t('Firestore config: NEWCO Jan 2027', () => {
    const path = buildDropboxFolderPath('Random Co', '2027', '1', {
        dropboxConfig: { folderBasePath: 'NEWCO', folderPrefix: 'NC' },
    });
    assert.strictEqual(path, '/NEWCO/NC_ARVED/NC_arved_meile/NC_arved_meile_2027/NC_arved_meile_2027_1');
});

t('Unknown company falls back to UNKNOWN_COMPANY path', () => {
    const path = buildDropboxFolderPath('Random Co', '2026', '5');
    assert.strictEqual(path, '/UNKNOWN_COMPANY/UK_ARVED/UK_arved_meile/UK_arved_meile_2026/UK_arved_meile_2026_5');
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
