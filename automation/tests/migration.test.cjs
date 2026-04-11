#!/usr/bin/env node
/**
 * Unit tests for migrate_users_to_billing.cjs buildMigrationDoc.
 *
 * Covers the pure factory only — the Firestore enumeration and .create
 * paths are exercised via dry-run against the real DB in the Sprint 4
 * deploy step.
 *
 * Run: node automation/tests/migration.test.cjs
 */

'use strict';

const assert = require('assert');
const { buildMigrationDoc, GRANDFATHER_BONUS } = require('../migrate_users_to_billing.cjs');
const { PLANS } = require('../core/billing.cjs');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n── buildMigrationDoc ──');

t('GRANDFATHER_BONUS is 1000 credits', () => {
    assert.strictEqual(GRANDFATHER_BONUS, 1000);
});

t('new user doc has plan=free', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.plan, PLANS.FREE);
    assert.strictEqual(doc.plan, 'free');
});

t('credits.limit = 50 (FREE monthly budget)', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.credits.limit, 50);
});

t('credits.purchased = 1000 grandfather bonus', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.credits.purchased, 1000);
});

t('credits.used starts at 0', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.credits.used, 0);
});

t('trial is inactive — no PRO trial for existing users', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.trial.active, false);
    assert.strictEqual(doc.trial.endsAt, null);
});

t('lemonSqueezy fields are null', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.lemonSqueezy.customerId, null);
    assert.strictEqual(doc.lemonSqueezy.subscriptionId, null);
    assert.strictEqual(doc.lemonSqueezy.variantId, null);
});

t('uid is stored', () => {
    const doc = buildMigrationDoc({ uid: 'abc123', email: 'x@y.com' });
    assert.strictEqual(doc.uid, 'abc123');
});

t('email is stored', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'user@example.com' });
    assert.strictEqual(doc.email, 'user@example.com');
});

t('email defaults to null when missing', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: '' });
    assert.strictEqual(doc.email, null);
});

t('billingCycle is monthly', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.billingCycle, 'monthly');
});

t('migration metadata is populated', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    assert.strictEqual(doc.migration.grandfatherBonus, 1000);
    assert.strictEqual(doc.migration.reason, 'existing_user_grandfather');
    assert.strictEqual(doc.migration.policyVersion, 1);
});

t('migratedAt timestamp is set', () => {
    const now = 1_800_000_000_000;
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com', now });
    assert.strictEqual(doc.migratedAt, now);
});

t('resetAt is 30 days from now', () => {
    const now = 1_800_000_000_000;
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com', now });
    assert.strictEqual(doc.credits.resetAt, now + 30 * 86400_000);
});

t('createdAt and updatedAt match now', () => {
    const now = 1_800_000_000_000;
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com', now });
    assert.strictEqual(doc.createdAt, now);
    assert.strictEqual(doc.updatedAt, now);
});

t('total spendable = 50 + 1000 = 1050', () => {
    const doc = buildMigrationDoc({ uid: 'u1', email: 'x@y.com' });
    const total = (doc.credits.limit - doc.credits.used) + doc.credits.purchased;
    assert.strictEqual(total, 1050);
});

console.log(`\n── ${passed}/${passed + failed} passed ──`);
process.exit(failed > 0 ? 1 : 0);
