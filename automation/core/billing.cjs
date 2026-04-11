/**
 * Billing — canonical plan config and credit constants.
 *
 * This is the single source of truth for:
 *   - Plan IDs ("free" | "pro" | "business")
 *   - Credit budget per plan
 *   - Credit cost of each billable action
 *   - Lemon Squeezy variant ID → plan mapping (populated from env)
 *   - Credit pack product mapping
 *
 * The webhook handler in billing_service.cjs resolves incoming events against
 * this config. Integration code (invoice_processor, document_ai_service,
 * bank_statement_processor) reads CREDIT_COSTS to charge spending.
 *
 * Variant IDs live in env vars so we can swap Lemon Squeezy test-mode IDs for
 * prod IDs without a code change. See .env.example for the full list.
 */

'use strict';

// ─── Plan IDs ────────────────────────────────────────────────────────────────
const PLANS = Object.freeze({
    FREE: 'free',
    PRO: 'pro',
    BUSINESS: 'business',
});

const VALID_PLANS = new Set(Object.values(PLANS));

// ─── Per-plan configuration ──────────────────────────────────────────────────
// Credits reset monthly on the billing anchor (subscription_created date).
// FREE resets on the 1st of each calendar month.
//
// Storage limits are informational — we don't enforce hard limits yet; the
// frontend shows them and the backend warns in dashboards.
const PLAN_CONFIG = Object.freeze({
    [PLANS.FREE]: {
        name: 'FREE',
        priceMonthly: 0,
        priceAnnual: 0,
        creditsPerMonth: 50,
        maxCompanies: 1,
        storageMB: 500,
        features: {
            bankReconciliation: false,
            meritAktiva: false,
            prioritySupport: false,
            emailSupport: false,
            teamSeats: 1,
        },
    },
    [PLANS.PRO]: {
        name: 'PRO',
        priceMonthly: 29,
        priceAnnual: 290,
        creditsPerMonth: 500,
        maxCompanies: 5,
        storageMB: 10240, // 10 GB
        features: {
            bankReconciliation: true,
            meritAktiva: false,
            prioritySupport: false,
            emailSupport: true,
            teamSeats: 1,
        },
        creditPackPrice: 0.05, // €/credit
    },
    [PLANS.BUSINESS]: {
        name: 'BUSINESS',
        priceMonthly: 79,
        priceAnnual: 790,
        creditsPerMonth: 2000,
        maxCompanies: Infinity,
        storageMB: 102400, // 100 GB
        features: {
            bankReconciliation: true,
            meritAktiva: true,
            prioritySupport: true,
            emailSupport: true,
            teamSeats: 10,
        },
        creditPackPrice: 0.03, // €/credit
    },
});

// ─── Credit cost per billable action ─────────────────────────────────────────
// Each spend call cites one of these action IDs so auditing is easy.
// New integrations MUST add their action here, not inline magic numbers.
const CREDIT_COSTS = Object.freeze({
    // OCR + field extraction from one invoice (one document, not one file —
    // a multi-invoice PDF costs N credits).
    ai_extraction: 1,

    // Matching a bank transaction to an invoice.
    bank_reconciliation: 1,

    // Teacher learning a new vendor pattern from examples.
    ai_teacher_rule: 1,

    // Duplicate detection via AI signature (content hash is free; this is
    // the fuzzy/semantic pass).
    smart_duplicate_check: 1,

    // Auto-categorization of an expense (GL account suggestion).
    auto_categorization: 1,
});

const VALID_ACTIONS = new Set(Object.keys(CREDIT_COSTS));

// ─── Trial ───────────────────────────────────────────────────────────────────
const TRIAL_DAYS = 14;
const TRIAL_PLAN = PLANS.PRO; // Every new user gets 14 days of PRO

// ─── Lemon Squeezy variant mapping ───────────────────────────────────────────
// Populated from env vars at startup. Variant IDs are integers in LS admin.
//
// Env var naming:
//   LEMON_VARIANT_PRO_MONTHLY   — PRO subscription, monthly cycle
//   LEMON_VARIANT_PRO_ANNUAL    — PRO subscription, annual cycle
//   LEMON_VARIANT_BUSINESS_MONTHLY
//   LEMON_VARIANT_BUSINESS_ANNUAL
//   LEMON_VARIANT_CREDITS_100   — credit pack, one-time purchase (100 credits)
//   LEMON_VARIANT_CREDITS_500
//   LEMON_VARIANT_CREDITS_1000
//
// Unset vars are OK during development — resolution functions return null
// and the webhook handler logs a warning.
function buildVariantMap() {
    const env = process.env;
    const asNum = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    return {
        subscriptions: {
            [asNum(env.LEMON_VARIANT_PRO_MONTHLY)]: { plan: PLANS.PRO, billingCycle: 'monthly' },
            [asNum(env.LEMON_VARIANT_PRO_ANNUAL)]: { plan: PLANS.PRO, billingCycle: 'annual' },
            [asNum(env.LEMON_VARIANT_BUSINESS_MONTHLY)]: { plan: PLANS.BUSINESS, billingCycle: 'monthly' },
            [asNum(env.LEMON_VARIANT_BUSINESS_ANNUAL)]: { plan: PLANS.BUSINESS, billingCycle: 'annual' },
        },
        creditPacks: {
            [asNum(env.LEMON_VARIANT_CREDITS_100)]: 100,
            [asNum(env.LEMON_VARIANT_CREDITS_500)]: 500,
            [asNum(env.LEMON_VARIANT_CREDITS_1000)]: 1000,
        },
    };
}

/**
 * Resolve a Lemon Squeezy variant ID to { plan, billingCycle } or null.
 */
function resolveSubscriptionVariant(variantId) {
    if (variantId === null || variantId === undefined) return null;
    const key = Number(variantId);
    if (!Number.isFinite(key)) return null;
    const map = buildVariantMap().subscriptions;
    return map[key] || null;
}

/**
 * Resolve a Lemon Squeezy one-time product variant ID to the number of
 * credits the user purchased. Returns 0 if not a known credit pack.
 */
function resolveCreditPack(variantId) {
    if (variantId === null || variantId === undefined) return 0;
    const key = Number(variantId);
    if (!Number.isFinite(key)) return 0;
    const map = buildVariantMap().creditPacks;
    return map[key] || 0;
}

// ─── Plan lookup helpers ─────────────────────────────────────────────────────
function isValidPlan(plan) {
    return typeof plan === 'string' && VALID_PLANS.has(plan);
}

function getPlanConfig(plan) {
    if (!isValidPlan(plan)) return PLAN_CONFIG[PLANS.FREE];
    return PLAN_CONFIG[plan];
}

function getCreditsForPlan(plan) {
    return getPlanConfig(plan).creditsPerMonth;
}

function getCreditCost(action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Unknown billable action: "${action}". Add it to CREDIT_COSTS.`);
    }
    return CREDIT_COSTS[action];
}

// ─── Billing state factories ─────────────────────────────────────────────────
/**
 * Default billing document for a brand-new user. Written into
 * users/{uid}/billing by the auth-created trigger or the migration script.
 *
 * By policy, every new signup starts on a 14-day PRO trial so they can feel
 * the real product before hitting the FREE cap. After the trial expires the
 * webhook downgrades to FREE automatically (or subscription_created bumps
 * them to paid PRO if they checkout).
 */
function defaultBillingDoc({ uid = null, now = Date.now() } = {}) {
    const trialEndsAt = now + TRIAL_DAYS * 86400_000;
    const limit = getCreditsForPlan(TRIAL_PLAN);
    return {
        uid,
        plan: TRIAL_PLAN,
        billingCycle: 'monthly',
        credits: {
            limit,
            used: 0,
            purchased: 0,
            resetAt: trialEndsAt, // Trial resets when trial ends
        },
        trial: {
            active: true,
            endsAt: trialEndsAt,
        },
        lemonSqueezy: {
            customerId: null,
            subscriptionId: null,
            variantId: null,
        },
        createdAt: now,
        updatedAt: now,
    };
}

// ─── Credit math ─────────────────────────────────────────────────────────────
/**
 * Pure function: given a billing doc and a spend amount, return the NEW
 * billing doc state plus { allowed, remaining }.
 *
 * Rules:
 *   - Try monthly credits first (credits.used)
 *   - Fall back to one-time purchased credits (credits.purchased)
 *   - If total available < cost → allowed=false, no mutation
 *
 * The Firestore-side wrapper in billing_service.cjs runs this inside a
 * transaction so concurrent spends don't overspend.
 */
function computeSpend(billing, cost) {
    if (!billing || typeof billing !== 'object') {
        return { allowed: false, reason: 'no_billing_doc', remaining: 0 };
    }
    const credits = billing.credits || {};
    const limit = Number(credits.limit) || 0;
    const used = Number(credits.used) || 0;
    const purchased = Number(credits.purchased) || 0;

    const monthlyAvailable = Math.max(0, limit - used);
    const totalAvailable = monthlyAvailable + purchased;

    if (totalAvailable < cost) {
        return { allowed: false, reason: 'insufficient_credits', remaining: totalAvailable };
    }

    // Prefer burning monthly credits first
    let newUsed = used;
    let newPurchased = purchased;
    if (monthlyAvailable >= cost) {
        newUsed = used + cost;
    } else {
        newUsed = limit; // monthly fully burnt
        newPurchased = purchased - (cost - monthlyAvailable);
    }

    return {
        allowed: true,
        remaining: (limit - newUsed) + newPurchased,
        newCredits: {
            limit,
            used: newUsed,
            purchased: newPurchased,
            resetAt: credits.resetAt || null,
        },
    };
}

// ─── Webhook event types ─────────────────────────────────────────────────────
// Lemon Squeezy event names we handle. Anything else is logged and ignored.
const HANDLED_EVENTS = Object.freeze(new Set([
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'subscription_expired',
    'subscription_resumed',
    'subscription_payment_success',
    'subscription_payment_failed',
    'order_created', // used for credit pack one-time purchases
]));

// ─── Billing enforcement mode (gradual rollout gate) ────────────────────────
// Controls whether billable actions actually debit credits at runtime.
// Read from BILLING_ENFORCEMENT env var at every call site so the operator
// can flip modes without restarting the service.
//
//   'off'     (default) — no billing integration runs. Existing behavior.
//                        Used before the monetization rollout.
//   'shadow'  — read the billing doc, run computeSpend, log what WOULD
//               be charged, but write nothing. Use this to verify credit
//               math against real traffic without risk.
//   'enforce' — actually debit credits inside a Firestore transaction.
//               Soft-block when insufficient (callers decide what to do).
const BILLING_ENFORCEMENT_MODES = Object.freeze(['off', 'shadow', 'enforce']);

function getEnforcementMode() {
    const raw = String(process.env.BILLING_ENFORCEMENT || 'off').trim().toLowerCase();
    if (BILLING_ENFORCEMENT_MODES.includes(raw)) return raw;
    return 'off';
}

// ─── Billable-uid resolution ─────────────────────────────────────────────────
/**
 * Resolve which user's credit balance should be debited for an action that
 * affects `companyId`. Billing is per-user but invoice processing (IMAP
 * daemon, bank reconciler) runs as a system process without a logged-in
 * user, so every company must map to exactly one "billable owner".
 *
 * Resolution order:
 *   1. `companies/{companyId}.billingOwnerUid` — explicit override
 *   2. `companies/{companyId}.accountId` → `accounts/{accountId}.ownerUid`
 *   3. First user with role=admin in `accounts/{accountId}/users`
 *   4. null — caller should log a warning and either skip the charge or
 *      use the system fallback (see allowCredit)
 *
 * Passes the `db` instance as first arg so tests can inject a stub.
 *
 * @param {Firestore} db - Firebase Admin Firestore instance
 * @param {string}    companyId
 * @returns {Promise<string|null>}
 */
async function getBillableUidForCompany(db, companyId) {
    if (!db || !companyId) return null;

    // 1. Explicit billingOwnerUid on the company doc
    let companyData = null;
    try {
        const snap = await db.collection('companies').doc(companyId).get();
        if (snap.exists) {
            companyData = snap.data() || {};
            if (companyData.billingOwnerUid) return String(companyData.billingOwnerUid);
        }
    } catch (err) {
        console.warn(`[Billing] getBillableUidForCompany: company read failed — ${err.message}`);
    }

    // 2. account.ownerUid fallback via company.accountId
    const accountId = companyData && companyData.accountId;
    if (accountId) {
        try {
            const accSnap = await db.collection('accounts').doc(accountId).get();
            if (accSnap.exists) {
                const acc = accSnap.data() || {};
                if (acc.ownerUid) return String(acc.ownerUid);
            }

            // 3. First admin user in the account's user list
            const adminSnap = await db
                .collection('accounts').doc(accountId)
                .collection('users')
                .where('role', '==', 'admin')
                .limit(1)
                .get();
            if (!adminSnap.empty) {
                return String(adminSnap.docs[0].id);
            }
        } catch (err) {
            console.warn(`[Billing] getBillableUidForCompany: account fallback failed — ${err.message}`);
        }
    }

    return null;
}

module.exports = {
    PLANS,
    VALID_PLANS,
    PLAN_CONFIG,
    CREDIT_COSTS,
    VALID_ACTIONS,
    TRIAL_DAYS,
    TRIAL_PLAN,
    HANDLED_EVENTS,
    BILLING_ENFORCEMENT_MODES,
    getEnforcementMode,
    buildVariantMap,
    resolveSubscriptionVariant,
    resolveCreditPack,
    isValidPlan,
    getPlanConfig,
    getCreditsForPlan,
    getCreditCost,
    defaultBillingDoc,
    computeSpend,
    getBillableUidForCompany,
};
