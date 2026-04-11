#!/usr/bin/env node
/**
 * Unit tests for core/billing.cjs and billing_service.cjs (pure parts).
 * Run: node automation/tests/billing.test.cjs
 *
 * These tests stay firestore-free — they hit the pure functions
 * (computeSpend, plan config, variant resolution, HMAC verification)
 * without touching Firebase. Integration tests with a real Firestore
 * emulator live separately.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
    PLANS,
    PLAN_CONFIG,
    CREDIT_COSTS,
    TRIAL_DAYS,
    TRIAL_PLAN,
    HANDLED_EVENTS,
    isValidPlan,
    getPlanConfig,
    getCreditsForPlan,
    getCreditCost,
    defaultBillingDoc,
    computeSpend,
    resolveSubscriptionVariant,
    resolveCreditPack,
    getBillableUidForCompany,
} = require('../core/billing.cjs');

let passed = 0, failed = 0;
const pendingAsync = [];
function t(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            // Async test — register it and await in main runner
            pendingAsync.push(
                result
                    .then(() => { console.log(`  ✅ ${name}`); passed++; })
                    .catch((err) => { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; })
            );
        } else {
            console.log(`  ✅ ${name}`);
            passed++;
        }
    } catch (err) {
        console.log(`  ❌ ${name}\n     ${err.message}`);
        failed++;
    }
}

console.log('\n── plan config ──');

t('PLANS constants exist and are strings', () => {
    assert.strictEqual(PLANS.FREE, 'free');
    assert.strictEqual(PLANS.PRO, 'pro');
    assert.strictEqual(PLANS.BUSINESS, 'business');
});

t('PLAN_CONFIG has all three plans', () => {
    assert.ok(PLAN_CONFIG[PLANS.FREE]);
    assert.ok(PLAN_CONFIG[PLANS.PRO]);
    assert.ok(PLAN_CONFIG[PLANS.BUSINESS]);
});

t('FREE plan has 50 credits/month', () => {
    assert.strictEqual(PLAN_CONFIG[PLANS.FREE].creditsPerMonth, 50);
});

t('PRO plan has 500 credits/month and €29 price', () => {
    assert.strictEqual(PLAN_CONFIG[PLANS.PRO].creditsPerMonth, 500);
    assert.strictEqual(PLAN_CONFIG[PLANS.PRO].priceMonthly, 29);
    assert.strictEqual(PLAN_CONFIG[PLANS.PRO].priceAnnual, 290);
});

t('BUSINESS plan has 2000 credits/month and €79 price', () => {
    assert.strictEqual(PLAN_CONFIG[PLANS.BUSINESS].creditsPerMonth, 2000);
    assert.strictEqual(PLAN_CONFIG[PLANS.BUSINESS].priceMonthly, 79);
    assert.strictEqual(PLAN_CONFIG[PLANS.BUSINESS].priceAnnual, 790);
});

t('PLAN_CONFIG is frozen (immutable)', () => {
    assert.throws(() => { PLAN_CONFIG.free = { hijacked: true }; }, TypeError);
});

t('isValidPlan accepts valid plans', () => {
    assert.strictEqual(isValidPlan('free'), true);
    assert.strictEqual(isValidPlan('pro'), true);
    assert.strictEqual(isValidPlan('business'), true);
});

t('isValidPlan rejects unknown/invalid plans', () => {
    assert.strictEqual(isValidPlan('enterprise'), false);
    assert.strictEqual(isValidPlan(null), false);
    assert.strictEqual(isValidPlan(''), false);
    assert.strictEqual(isValidPlan(42), false);
});

t('getPlanConfig falls back to FREE for unknown plans', () => {
    assert.strictEqual(getPlanConfig('nonsense'), PLAN_CONFIG[PLANS.FREE]);
});

t('getCreditsForPlan returns correct budget', () => {
    assert.strictEqual(getCreditsForPlan('free'), 50);
    assert.strictEqual(getCreditsForPlan('pro'), 500);
    assert.strictEqual(getCreditsForPlan('business'), 2000);
});

console.log('\n── credit costs ──');

t('ai_extraction costs 1 credit', () => {
    assert.strictEqual(getCreditCost('ai_extraction'), 1);
});

t('bank_reconciliation costs 1 credit', () => {
    assert.strictEqual(getCreditCost('bank_reconciliation'), 1);
});

t('unknown action throws', () => {
    assert.throws(() => getCreditCost('nuclear_strike'), /Unknown billable action/);
});

t('CREDIT_COSTS is frozen', () => {
    assert.throws(() => { CREDIT_COSTS.free_lunch = 0; }, TypeError);
});

console.log('\n── defaultBillingDoc ──');

t('defaults to PRO trial with 500 credits', () => {
    const d = defaultBillingDoc({ uid: 'u1', now: 1_700_000_000_000 });
    assert.strictEqual(d.plan, TRIAL_PLAN);
    assert.strictEqual(d.plan, PLANS.PRO);
    assert.strictEqual(d.credits.limit, 500);
    assert.strictEqual(d.credits.used, 0);
    assert.strictEqual(d.credits.purchased, 0);
});

t('trial ends 14 days from now', () => {
    const now = 1_700_000_000_000;
    const d = defaultBillingDoc({ uid: 'u1', now });
    assert.strictEqual(d.trial.active, true);
    assert.strictEqual(d.trial.endsAt, now + TRIAL_DAYS * 86400_000);
});

t('uid is stored in the doc', () => {
    const d = defaultBillingDoc({ uid: 'abc123' });
    assert.strictEqual(d.uid, 'abc123');
});

t('createdAt and updatedAt are set', () => {
    const now = 1_700_000_000_000;
    const d = defaultBillingDoc({ uid: 'u1', now });
    assert.strictEqual(d.createdAt, now);
    assert.strictEqual(d.updatedAt, now);
});

console.log('\n── computeSpend ──');

const base = {
    plan: 'pro',
    credits: { limit: 500, used: 0, purchased: 0, resetAt: null },
};

t('empty/malformed billing → not allowed', () => {
    const r = computeSpend(null, 1);
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.reason, 'no_billing_doc');
});

t('fresh 500 budget + spend 1 → 499 remaining', () => {
    const r = computeSpend({ credits: { limit: 500, used: 0, purchased: 0 } }, 1);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 499);
    assert.strictEqual(r.newCredits.used, 1);
    assert.strictEqual(r.newCredits.purchased, 0);
});

t('spend 5 from 500 → 495 remaining', () => {
    const r = computeSpend({ credits: { limit: 500, used: 0, purchased: 0 } }, 5);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 495);
    assert.strictEqual(r.newCredits.used, 5);
});

t('exact exhaustion: limit 50, used 50, spend 1 → blocked', () => {
    const r = computeSpend({ credits: { limit: 50, used: 50, purchased: 0 } }, 1);
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.reason, 'insufficient_credits');
    assert.strictEqual(r.remaining, 0);
});

t('overflow: limit 50, used 49, spend 2 → blocked, monthly alone not enough', () => {
    const r = computeSpend({ credits: { limit: 50, used: 49, purchased: 0 } }, 2);
    assert.strictEqual(r.allowed, false);
});

t('fallback to purchased: limit 50, used 50, purchased 10, spend 5 → OK, purchased=5', () => {
    const r = computeSpend({ credits: { limit: 50, used: 50, purchased: 10 } }, 5);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 5);
    assert.strictEqual(r.newCredits.purchased, 5);
    assert.strictEqual(r.newCredits.used, 50);
});

t('crosses boundary: limit 50, used 48, purchased 10, spend 5 → 2 from monthly, 3 from purchased', () => {
    const r = computeSpend({ credits: { limit: 50, used: 48, purchased: 10 } }, 5);
    assert.strictEqual(r.allowed, true);
    // After spend: used=50 (burnt all 2 monthly), purchased=10-3=7
    assert.strictEqual(r.newCredits.used, 50);
    assert.strictEqual(r.newCredits.purchased, 7);
    assert.strictEqual(r.remaining, 0 + 7); // 0 monthly + 7 purchased
});

t('purchased credits cover request entirely when monthly exhausted', () => {
    const r = computeSpend({ credits: { limit: 50, used: 50, purchased: 100 } }, 25);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.newCredits.purchased, 75);
    assert.strictEqual(r.remaining, 75);
});

t('5-invoice multi-doc PDF costs 5 credits', () => {
    const r = computeSpend({ credits: { limit: 500, used: 0, purchased: 0 } }, 5);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.newCredits.used, 5);
});

console.log('\n── variant mapping ──');

t('resolveSubscriptionVariant returns null for unknown variant', () => {
    const prev = process.env.LEMON_VARIANT_PRO_MONTHLY;
    delete process.env.LEMON_VARIANT_PRO_MONTHLY;
    assert.strictEqual(resolveSubscriptionVariant(999999), null);
    if (prev !== undefined) process.env.LEMON_VARIANT_PRO_MONTHLY = prev;
});

t('resolveSubscriptionVariant matches configured variant', () => {
    process.env.LEMON_VARIANT_PRO_MONTHLY = '12345';
    const r = resolveSubscriptionVariant(12345);
    assert.ok(r);
    assert.strictEqual(r.plan, 'pro');
    assert.strictEqual(r.billingCycle, 'monthly');
    delete process.env.LEMON_VARIANT_PRO_MONTHLY;
});

t('resolveSubscriptionVariant matches annual cycle', () => {
    process.env.LEMON_VARIANT_BUSINESS_ANNUAL = '67890';
    const r = resolveSubscriptionVariant('67890'); // string input works
    assert.ok(r);
    assert.strictEqual(r.plan, 'business');
    assert.strictEqual(r.billingCycle, 'annual');
    delete process.env.LEMON_VARIANT_BUSINESS_ANNUAL;
});

t('resolveSubscriptionVariant handles null/undefined safely', () => {
    assert.strictEqual(resolveSubscriptionVariant(null), null);
    assert.strictEqual(resolveSubscriptionVariant(undefined), null);
    assert.strictEqual(resolveSubscriptionVariant('not-a-number'), null);
});

t('resolveCreditPack returns 0 for unknown variant', () => {
    assert.strictEqual(resolveCreditPack(999999), 0);
});

t('resolveCreditPack matches configured pack', () => {
    process.env.LEMON_VARIANT_CREDITS_500 = '55555';
    assert.strictEqual(resolveCreditPack(55555), 500);
    delete process.env.LEMON_VARIANT_CREDITS_500;
});

console.log('\n── HANDLED_EVENTS ──');

t('HANDLED_EVENTS includes subscription lifecycle', () => {
    assert.ok(HANDLED_EVENTS.has('subscription_created'));
    assert.ok(HANDLED_EVENTS.has('subscription_updated'));
    assert.ok(HANDLED_EVENTS.has('subscription_cancelled'));
    assert.ok(HANDLED_EVENTS.has('subscription_expired'));
    assert.ok(HANDLED_EVENTS.has('subscription_payment_success'));
    assert.ok(HANDLED_EVENTS.has('subscription_payment_failed'));
});

t('HANDLED_EVENTS includes order_created for credit packs', () => {
    assert.ok(HANDLED_EVENTS.has('order_created'));
});

t('HANDLED_EVENTS excludes unrelated events', () => {
    assert.strictEqual(HANDLED_EVENTS.has('customer_created'), false);
    assert.strictEqual(HANDLED_EVENTS.has('nuclear_launch'), false);
});

console.log('\n── webhook HMAC verification ──');

// Import billing_service lazily so we don't pull in Firestore init when
// just testing the pure verifyWebhook function.
const { verifyWebhook, _extractUidFromEvent } = require('../billing_service.cjs');

t('verifyWebhook returns false without LEMON_WEBHOOK_SECRET', () => {
    const prev = process.env.LEMON_WEBHOOK_SECRET;
    delete process.env.LEMON_WEBHOOK_SECRET;
    assert.strictEqual(verifyWebhook(Buffer.from('{}'), 'deadbeef'), false);
    if (prev !== undefined) process.env.LEMON_WEBHOOK_SECRET = prev;
});

t('verifyWebhook accepts a valid HMAC signature', () => {
    process.env.LEMON_WEBHOOK_SECRET = 'test-secret';
    const body = Buffer.from('{"hello":"world"}');
    const expected = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
    assert.strictEqual(verifyWebhook(body, expected), true);
    delete process.env.LEMON_WEBHOOK_SECRET;
});

t('verifyWebhook rejects a tampered body', () => {
    process.env.LEMON_WEBHOOK_SECRET = 'test-secret';
    const body = Buffer.from('{"hello":"world"}');
    const expected = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
    const tampered = Buffer.from('{"hello":"evil"}');
    assert.strictEqual(verifyWebhook(tampered, expected), false);
    delete process.env.LEMON_WEBHOOK_SECRET;
});

t('verifyWebhook rejects a wrong signature of same length', () => {
    process.env.LEMON_WEBHOOK_SECRET = 'test-secret';
    const body = Buffer.from('{"x":1}');
    const wrong = 'a'.repeat(64);
    assert.strictEqual(verifyWebhook(body, wrong), false);
    delete process.env.LEMON_WEBHOOK_SECRET;
});

t('verifyWebhook rejects missing signature', () => {
    process.env.LEMON_WEBHOOK_SECRET = 'test-secret';
    assert.strictEqual(verifyWebhook(Buffer.from('{}'), null), false);
    assert.strictEqual(verifyWebhook(Buffer.from('{}'), ''), false);
    delete process.env.LEMON_WEBHOOK_SECRET;
});

t('verifyWebhook works with string body', () => {
    process.env.LEMON_WEBHOOK_SECRET = 'test-secret';
    const body = '{"hello":"world"}';
    const expected = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
    assert.strictEqual(verifyWebhook(body, expected), true);
    delete process.env.LEMON_WEBHOOK_SECRET;
});

console.log('\n── extractUidFromEvent ──');

t('extracts uid from meta.custom_data', () => {
    const uid = _extractUidFromEvent({ meta: { custom_data: { uid: 'u1' } }, data: {} });
    assert.strictEqual(uid, 'u1');
});

t('extracts uid from data.attributes.custom_data', () => {
    const uid = _extractUidFromEvent({
        meta: {},
        data: { attributes: { custom_data: { uid: 'u2' } } },
    });
    assert.strictEqual(uid, 'u2');
});

t('extracts uid from first_order_item.custom_data', () => {
    const uid = _extractUidFromEvent({
        meta: {},
        data: { attributes: { first_order_item: { custom_data: { uid: 'u3' } } } },
    });
    assert.strictEqual(uid, 'u3');
});

t('returns null when no uid present', () => {
    assert.strictEqual(_extractUidFromEvent({ meta: {}, data: {} }), null);
    assert.strictEqual(_extractUidFromEvent({}), null);
    assert.strictEqual(_extractUidFromEvent(null), null);
});

console.log('\n── getBillableUidForCompany ──');

// Tiny in-memory Firestore stub so we can test the resolver without hitting
// real Firebase. Mirrors just enough of the Admin SDK surface to work.
function makeDbStub({ companies = {}, accounts = {}, accountUsers = {} } = {}) {
    const docStub = (exists, data) => ({
        exists,
        data: () => data,
        id: data?._id || '',
    });
    const collection = (name) => ({
        doc: (id) => ({
            get: async () => {
                const store = name === 'companies' ? companies : name === 'accounts' ? accounts : {};
                return store[id] ? docStub(true, store[id]) : docStub(false, null);
            },
            collection: (sub) => ({
                where: (field, op, value) => ({
                    limit: () => ({
                        get: async () => {
                            const list = accountUsers[id] || [];
                            const filtered = list.filter(u => u[field] === value);
                            return {
                                empty: filtered.length === 0,
                                docs: filtered.map(u => ({ id: u._id, data: () => u })),
                            };
                        },
                    }),
                }),
            }),
        }),
    });
    return { collection };
}

t('null db → null', async () => {
    const r = await getBillableUidForCompany(null, 'c1');
    assert.strictEqual(r, null);
});

t('null companyId → null', async () => {
    const db = makeDbStub();
    const r = await getBillableUidForCompany(db, null);
    assert.strictEqual(r, null);
});

t('company with explicit billingOwnerUid wins', async () => {
    const db = makeDbStub({
        companies: { c1: { billingOwnerUid: 'explicit-uid', accountId: 'acc1' } },
        accounts: { acc1: { ownerUid: 'account-owner' } },
    });
    const r = await getBillableUidForCompany(db, 'c1');
    assert.strictEqual(r, 'explicit-uid');
});

t('falls back to account.ownerUid when company has no owner', async () => {
    const db = makeDbStub({
        companies: { c1: { accountId: 'acc1' } },
        accounts: { acc1: { ownerUid: 'account-owner' } },
    });
    const r = await getBillableUidForCompany(db, 'c1');
    assert.strictEqual(r, 'account-owner');
});

t('falls back to first admin user when account has no owner', async () => {
    const db = makeDbStub({
        companies: { c1: { accountId: 'acc1' } },
        accounts: { acc1: { name: 'No-owner Inc' } },
        accountUsers: {
            acc1: [
                { _id: 'admin-uid-1', role: 'admin' },
                { _id: 'user-uid-1', role: 'user' },
            ],
        },
    });
    const r = await getBillableUidForCompany(db, 'c1');
    assert.strictEqual(r, 'admin-uid-1');
});

t('returns null when nothing resolves', async () => {
    const db = makeDbStub({
        companies: { c1: { accountId: 'acc1' } },
        accounts: { acc1: {} },
        accountUsers: { acc1: [{ _id: 'user-uid', role: 'user' }] },
    });
    const r = await getBillableUidForCompany(db, 'c1');
    assert.strictEqual(r, null);
});

t('returns null for unknown company with no accountId', async () => {
    const db = makeDbStub({ companies: { c1: {} } });
    const r = await getBillableUidForCompany(db, 'c1');
    assert.strictEqual(r, null);
});

t('handles company read errors gracefully', async () => {
    const broken = {
        collection: () => ({
            doc: () => ({
                get: async () => { throw new Error('network down'); },
                collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }),
            }),
        }),
    };
    const r = await getBillableUidForCompany(broken, 'c1');
    assert.strictEqual(r, null);
});

// Wait for all async test promises to settle before reporting final tally.
(async () => {
    await Promise.all(pendingAsync);
    console.log(`\n── ${passed}/${passed + failed} passed ──`);
    process.exit(failed > 0 ? 1 : 0);
})();
