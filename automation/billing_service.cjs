/**
 * Billing service — the runtime logic around plans, credits, and Lemon
 * Squeezy webhooks.
 *
 * Three public surfaces:
 *   1. verifyWebhook(rawBody, signatureHeader) — HMAC SHA-256 check against
 *      LEMON_WEBHOOK_SECRET. Constant-time compare.
 *   2. handleLemonWebhook(event) — dispatches a verified event to the right
 *      internal handler (subscription_* / order_created). Idempotent: the
 *      same event ID is never applied twice thanks to a billing_events
 *      Firestore collection with atomic .create().
 *   3. spendCredits({ uid, action, units }) — transactional debit of a
 *      billable action. Called from invoice_processor.cjs, document_ai_
 *      service.cjs, bank_statement_processor.cjs. Fails loudly if the user
 *      has no billing doc or insufficient credits.
 *
 * All writes go through Firestore transactions so parallel intake workers
 * never overspend a user's balance.
 *
 * Security: webhook endpoint is UNAUTHENTICATED by design (Lemon Squeezy
 * doesn't speak Firebase ID tokens). The HMAC signature is the only
 * trust boundary — fail closed if LEMON_WEBHOOK_SECRET is missing.
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const crypto = require('crypto');
const { admin, db } = require('./core/firebase.cjs');
const {
    PLANS,
    PLAN_CONFIG,
    HANDLED_EVENTS,
    TRIAL_DAYS,
    resolveSubscriptionVariant,
    resolveCreditPack,
    getCreditsForPlan,
    getCreditCost,
    defaultBillingDoc,
    computeSpend,
    getBillableUidForCompany,
    getEnforcementMode,
} = require('./core/billing.cjs');

const DAY_MS = 86400_000;

// ─── Webhook HMAC verification ───────────────────────────────────────────────
/**
 * Verify the X-Signature header on a Lemon Squeezy webhook request.
 *
 * Lemon Squeezy sends an HMAC-SHA256 hex digest of the raw body, keyed on
 * the webhook secret configured in their admin panel. We MUST verify against
 * the raw buffer, not the parsed JSON, otherwise key ordering changes break
 * the signature.
 *
 * @param {Buffer|string} rawBody - raw request body
 * @param {string}        signatureHex - value of X-Signature header
 * @returns {boolean} true if signature matches
 */
function verifyWebhook(rawBody, signatureHex) {
    const secret = process.env.LEMON_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[Billing] ❌ LEMON_WEBHOOK_SECRET not set — refusing to process webhook.');
        return false;
    }
    if (typeof signatureHex !== 'string' || signatureHex.length === 0) return false;

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const expectedHex = hmac.digest('hex');

    const a = Buffer.from(expectedHex);
    const b = Buffer.from(signatureHex);
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

// ─── Webhook dispatcher ──────────────────────────────────────────────────────
/**
 * Apply a verified Lemon Squeezy webhook event.
 *
 * @param {object} event — parsed webhook body (Lemon Squeezy JSON:API format)
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
async function handleLemonWebhook(event) {
    if (!event || typeof event !== 'object') {
        return { handled: false, reason: 'invalid_body' };
    }
    const meta = event.meta || {};
    const eventName = meta.event_name || '';
    const eventId = meta.webhook_id || meta.event_id || event?.data?.id || null;

    if (!HANDLED_EVENTS.has(eventName)) {
        console.log(`[Billing] Ignoring event: ${eventName}`);
        return { handled: false, reason: 'unhandled_event_type' };
    }

    // Idempotency: atomic .create on billing_events/{eventId} — if the doc
    // already exists the second attempt throws ALREADY_EXISTS and we bail.
    if (eventId && db) {
        const ref = db.collection('billing_events').doc(String(eventId));
        try {
            await ref.create({
                eventName,
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                // Store a compact copy — full payload trimmed to reduce Firestore size.
                payload: {
                    data: event.data || null,
                    meta: event.meta || null,
                },
            });
        } catch (err) {
            if (err && (err.code === 6 || /ALREADY_EXISTS/.test(String(err.message)))) {
                console.log(`[Billing] Duplicate event ${eventId} — skipping`);
                return { handled: true, reason: 'duplicate' };
            }
            throw err;
        }
    }

    const uid = extractUidFromEvent(event);
    if (!uid) {
        console.warn(`[Billing] ⚠️  ${eventName}: no uid found in custom_data — cannot apply`);
        return { handled: false, reason: 'missing_uid' };
    }

    switch (eventName) {
        case 'subscription_created':
        case 'subscription_updated':
        case 'subscription_resumed':
        case 'subscription_payment_success':
            await applySubscriptionActivation(uid, event);
            break;

        case 'subscription_cancelled':
            await applySubscriptionCancellation(uid, event, 'cancelled');
            break;

        case 'subscription_expired':
            await applySubscriptionCancellation(uid, event, 'expired');
            break;

        case 'subscription_payment_failed':
            await applyPaymentFailed(uid, event);
            break;

        case 'order_created':
            await applyOrderCreated(uid, event);
            break;

        default:
            console.log(`[Billing] Unhandled event: ${eventName}`);
            return { handled: false, reason: 'unhandled_event_type' };
    }

    return { handled: true };
}

/**
 * Extract the Firebase UID from the event's custom_data. Checkouts are
 * created with `custom_data: { uid: <uid> }` on the Lemon Squeezy checkout
 * URL so the webhook can identify the user.
 */
function extractUidFromEvent(event) {
    const customData =
        event?.meta?.custom_data ||
        event?.data?.attributes?.first_order_item?.custom_data ||
        event?.data?.attributes?.custom_data ||
        null;
    if (customData && typeof customData.uid === 'string') return customData.uid;
    return null;
}

/**
 * subscription_created / updated / resumed / payment_success → ensure the
 * user's billing doc reflects the new plan + credit budget.
 *
 * We always reset credits.used = 0 on a fresh billing cycle so users get a
 * full new pool when they upgrade or renew. purchased credits roll over.
 */
async function applySubscriptionActivation(uid, event) {
    const attr = event?.data?.attributes || {};
    const variantId = attr.variant_id ?? attr.product_id ?? null;
    const subscriptionId = event?.data?.id || attr.subscription_id || null;
    const customerId = attr.customer_id || null;

    const resolved = resolveSubscriptionVariant(variantId);
    if (!resolved) {
        console.warn(`[Billing] ⚠️  No plan mapping for variant ${variantId} — check LEMON_VARIANT_* env vars`);
        return;
    }
    const { plan, billingCycle } = resolved;
    const limit = getCreditsForPlan(plan);

    if (!db) {
        console.warn('[Billing] Firestore not initialized — skipping activation');
        return;
    }

    const ref = db.collection('users').doc(uid).collection('billing').doc('state');
    await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const existing = snap.exists ? snap.data() : {};
        const existingCredits = existing.credits || {};

        const now = Date.now();
        const resetAt = now + 30 * DAY_MS;

        t.set(ref, {
            uid,
            plan,
            billingCycle,
            credits: {
                limit,
                used: 0,
                // Roll over purchased (one-time credit pack) credits
                purchased: Number(existingCredits.purchased) || 0,
                resetAt,
            },
            trial: {
                active: false,
                endsAt: null,
            },
            lemonSqueezy: {
                customerId,
                subscriptionId,
                variantId,
            },
            updatedAt: now,
            // Preserve createdAt if the doc existed
            createdAt: existing.createdAt || now,
        }, { merge: false });
    });

    console.log(`[Billing] ✅ ${uid} → ${plan} (${billingCycle}), credits.limit=${limit}`);
}

/**
 * subscription_cancelled / expired → downgrade to FREE at the end of the
 * current cycle. We don't immediately strip access — Lemon Squeezy already
 * handles paid access until period end.
 */
async function applySubscriptionCancellation(uid, event, reason) {
    if (!db) return;
    const ref = db.collection('users').doc(uid).collection('billing').doc('state');
    const freeLimit = getCreditsForPlan(PLANS.FREE);

    await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) return;
        const existing = snap.data();
        const existingCredits = existing.credits || {};

        t.update(ref, {
            plan: PLANS.FREE,
            billingCycle: 'monthly',
            credits: {
                limit: freeLimit,
                used: Math.min(existingCredits.used || 0, freeLimit),
                purchased: Number(existingCredits.purchased) || 0,
                resetAt: Date.now() + 30 * DAY_MS,
            },
            trial: { active: false, endsAt: null },
            cancellationReason: reason,
            updatedAt: Date.now(),
        });
    });

    console.log(`[Billing] 🔻 ${uid} → FREE (${reason})`);
}

/**
 * subscription_payment_failed → leave the plan in place (LS gives grace
 * period) but raise a flag the frontend can surface.
 */
async function applyPaymentFailed(uid, event) {
    if (!db) return;
    const ref = db.collection('users').doc(uid).collection('billing').doc('state');
    await ref.set({
        paymentFailed: true,
        paymentFailedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.warn(`[Billing] ⚠️  Payment failed for ${uid}`);
}

/**
 * order_created → might be either the initial checkout that created a
 * subscription (handled in subscription_created instead) OR a one-time
 * credit pack purchase. We only top up credits if the variant is a known
 * credit pack.
 */
async function applyOrderCreated(uid, event) {
    const attr = event?.data?.attributes || {};
    const firstItem = attr.first_order_item || {};
    const variantId = firstItem.variant_id ?? attr.variant_id ?? null;

    const credits = resolveCreditPack(variantId);
    if (credits <= 0) {
        // Not a credit pack — subscription_created fires separately for subs,
        // so we don't need to act on this order.
        console.log(`[Billing] order_created for ${uid}: variant ${variantId} is not a credit pack, skipping`);
        return;
    }

    if (!db) return;
    const ref = db.collection('users').doc(uid).collection('billing').doc('state');
    await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const existing = snap.exists ? snap.data() : defaultBillingDoc({ uid });
        const existingCredits = existing.credits || {};
        t.set(ref, {
            ...existing,
            credits: {
                ...existingCredits,
                purchased: (Number(existingCredits.purchased) || 0) + credits,
            },
            updatedAt: Date.now(),
        });
    });

    console.log(`[Billing] 💳 ${uid} +${credits} credits (pack purchase)`);
}

// ─── Credit spending ─────────────────────────────────────────────────────────
/**
 * Transactionally deduct credits for a billable action.
 *
 * Usage:
 *   const r = await spendCredits({ uid: 'abc123', action: 'ai_extraction' });
 *   if (!r.allowed) return softBlockResponse(r.reason);
 *
 * Multi-unit actions (e.g. processing a 5-invoice PDF) pass `units: 5`.
 * Returns `{ allowed, remaining, reason?, mode }`. Never throws for the
 * common "insufficient credits" case — it returns { allowed: false,
 * reason: 'insufficient_credits' } so callers can soft-block cleanly.
 *
 * Modes (passed directly OR resolved from BILLING_ENFORCEMENT env var):
 *   - 'off'     — passthrough, no reads or writes. Returns { allowed: true }.
 *   - 'shadow'  — reads the billing doc, runs computeSpend, logs what it
 *                 WOULD charge, writes nothing. Used to validate math
 *                 against production traffic without risk.
 *   - 'enforce' — full transactional debit + audit log.
 *
 * Throws only on Firestore errors or invalid inputs.
 */
async function spendCredits({ uid, action, units = 1, mode }) {
    if (!uid || typeof uid !== 'string') throw new Error('spendCredits: uid is required');
    const perUnitCost = getCreditCost(action); // throws on unknown action
    const total = perUnitCost * Math.max(1, Number(units) || 1);
    const effectiveMode = mode || getEnforcementMode();

    // Mode 'off' — do nothing, return allowed. This is the default so the
    // integration call sites are no-ops until the operator flips the flag.
    if (effectiveMode === 'off') {
        return { allowed: true, remaining: Infinity, mode: 'off' };
    }

    if (!db) {
        // No Firestore in test/dev contexts — treat as allowed but warn.
        console.warn('[Billing] Firestore unavailable — spendCredits passthrough');
        return { allowed: true, remaining: Infinity, mode: effectiveMode };
    }

    const ref = db.collection('users').doc(uid).collection('billing').doc('state');

    // Mode 'shadow' — read-only pass. Log what we would charge so the
    // operator can compare against actual usage before enabling enforcement.
    if (effectiveMode === 'shadow') {
        try {
            const snap = await ref.get();
            const billing = snap.exists ? snap.data() : defaultBillingDoc({ uid });
            const spend = computeSpend(billing, total);
            console.log(
                `[Billing:shadow] would charge uid=${uid} action=${action} units=${units} ` +
                `cost=${total} allowed=${spend.allowed} remaining=${spend.remaining ?? 0}`
            );
            return { ...spend, mode: 'shadow' };
        } catch (err) {
            console.warn(`[Billing:shadow] read failed (non-critical): ${err.message}`);
            return { allowed: true, remaining: Infinity, mode: 'shadow' };
        }
    }

    // Mode 'enforce' — real transactional debit
    const result = await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) {
            // New user without a billing doc — seed a default (trial) one
            // and let them spend from the trial budget.
            const fresh = defaultBillingDoc({ uid });
            const spend = computeSpend(fresh, total);
            if (!spend.allowed) return spend;
            t.set(ref, {
                ...fresh,
                credits: { ...fresh.credits, ...spend.newCredits },
                updatedAt: Date.now(),
            });
            return { allowed: true, remaining: spend.remaining };
        }

        const billing = snap.data();
        const spend = computeSpend(billing, total);
        if (!spend.allowed) return spend;

        t.update(ref, {
            'credits.limit': spend.newCredits.limit,
            'credits.used': spend.newCredits.used,
            'credits.purchased': spend.newCredits.purchased,
            updatedAt: Date.now(),
        });
        return { allowed: true, remaining: spend.remaining };
    });

    // Fire-and-forget audit log of the spend (non-blocking)
    if (result.allowed) {
        try {
            await db.collection('billing_events').add({
                type: 'spend',
                uid,
                action,
                units,
                cost: total,
                remaining: result.remaining,
                at: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (auditErr) {
            console.warn(`[Billing] audit log failed (non-critical): ${auditErr.message}`);
        }
    }

    return { ...result, mode: 'enforce' };
}

/**
 * chargeForCompany — the one-line call site for integration code. Wraps
 * uid resolution + spendCredits so invoice_processor, bank_statement_
 * processor, and friends don't have to duplicate the plumbing.
 *
 * Flow:
 *   1. If BILLING_ENFORCEMENT=off → return { allowed: true, mode: 'off' }
 *      without any Firestore reads. Cheap no-op.
 *   2. Resolve the billable uid via getBillableUidForCompany.
 *   3. If no uid → log a warning and return { allowed: true, mode,
 *      reason: 'no_billable_uid' }. Never block ingestion because of
 *      missing metadata — flag it and move on.
 *   4. Call spendCredits with the resolved mode.
 *
 * Always returns an object; never throws for the common case.
 */
async function chargeForCompany({ companyId, action, units = 1, mode }) {
    const effectiveMode = mode || getEnforcementMode();

    if (effectiveMode === 'off') {
        return { allowed: true, mode: 'off', remaining: Infinity };
    }
    if (!db) {
        return { allowed: true, mode: effectiveMode, remaining: Infinity };
    }
    if (!companyId) {
        console.warn(`[Billing] chargeForCompany called without companyId (action=${action})`);
        return { allowed: true, mode: effectiveMode, reason: 'no_company_id' };
    }

    const uid = await getBillableUidForCompany(db, companyId);
    if (!uid) {
        console.warn(`[Billing] No billable uid for companyId=${companyId} — skipping charge (${action}, ${units} units)`);
        return { allowed: true, mode: effectiveMode, reason: 'no_billable_uid' };
    }

    try {
        return await spendCredits({ uid, action, units, mode: effectiveMode });
    } catch (err) {
        console.error(`[Billing] chargeForCompany failed for uid=${uid} action=${action}: ${err.message}`);
        // Fail open during rollout — don't break invoice processing because
        // of a billing error. Operators can watch logs for these.
        return { allowed: true, mode: effectiveMode, reason: 'charge_error', error: err.message };
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────
module.exports = {
    verifyWebhook,
    handleLemonWebhook,
    spendCredits,
    chargeForCompany,
    // Exposed for tests
    _extractUidFromEvent: extractUidFromEvent,
    _applySubscriptionActivation: applySubscriptionActivation,
    _applyOrderCreated: applyOrderCreated,
};
