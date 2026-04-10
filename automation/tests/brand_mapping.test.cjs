#!/usr/bin/env node
/**
 * Unit tests for core/brand_mapping.cjs.
 * Run: node automation/tests/brand_mapping.test.cjs
 */

const assert = require('assert');
const { findLegalEntityByBrand, normalizeBrand, invalidateBrandCache } = require('../core/brand_mapping.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    return (async () => {
        try { await fn(); console.log(`  ✅ ${name}`); passed++; }
        catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
    })();
}

// In-memory mock Firestore that supports collection().get()
function makeMockDb(aliases) {
    return {
        collection: () => ({
            get: async () => ({
                docs: aliases.map((a, i) => ({
                    id: 'alias' + i,
                    data: () => a,
                })),
            }),
        }),
    };
}

async function main() {
    console.log('\n── normalizeBrand ──');
    await t('lowercases + strips quotes', () => {
        assert.strictEqual(normalizeBrand('"Kookon Nutilaod"'), 'kookon nutilaod');
    });
    await t('collapses whitespace', () => {
        assert.strictEqual(normalizeBrand('  Bolt   Operations  '), 'bolt operations');
    });
    await t('null → empty', () => {
        assert.strictEqual(normalizeBrand(null), '');
    });

    console.log('\n── findLegalEntityByBrand ──');

    const ALIASES = [
        { brand: 'Kookon Nutilaod', legalName: 'Allstore Assets OÜ', regCode: '16234567', vatNumber: 'EE102530000' },
        { brand: 'Bolt',            legalName: 'Bolt Operations OÜ' },
        { brand: 'Wolt Enterprises Eesti', legalName: 'Wolt Enterprises Eesti OÜ' },
    ];

    await t('exact match — Kookon Nutilaod → Allstore Assets OÜ', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'Kookon Nutilaod');
        assert.ok(r);
        assert.strictEqual(r.legalName, 'Allstore Assets OÜ');
    });

    await t('case-insensitive', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'KOOKON NUTILAOD');
        assert.ok(r);
        assert.strictEqual(r.legalName, 'Allstore Assets OÜ');
    });

    await t('substring match — "Bolt Technology OÜ" matches "Bolt"', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'Bolt Technology OÜ');
        assert.ok(r);
        assert.strictEqual(r.legalName, 'Bolt Operations OÜ');
    });

    await t('reverse substring — "Wolt Enterprises Eesti" inside longer brand', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'Wolt Enterprises');
        assert.ok(r);
        assert.strictEqual(r.legalName, 'Wolt Enterprises Eesti OÜ');
    });

    await t('no match → null', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'Random Vendor OÜ');
        assert.strictEqual(r, null);
    });

    await t('returns regCode and vatNumber when present', async () => {
        invalidateBrandCache();
        const db = makeMockDb(ALIASES);
        const r = await findLegalEntityByBrand(db, 'Kookon Nutilaod');
        assert.strictEqual(r.regCode, '16234567');
        assert.strictEqual(r.vatNumber, 'EE102530000');
    });

    console.log(`\n── ${passed}/${passed + failed} passed ──`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
