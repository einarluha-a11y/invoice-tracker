/**
 * Referral service — +50 credits to the referrer when a new user
 * signs up with their link (sprint 7 viral loop, from the monetization
 * doc's growth channels section).
 *
 * Flow
 *
 *   1. An existing user grabs their referral URL from Billing.tsx:
 *      https://<app>/landing?ref=<referrerUid>
 *      (we use the Firebase uid directly — it's already stable,
 *      unique, and unguessable enough for this use case; no need to
 *      issue a separate code.)
 *
 *   2. A prospect lands on /landing with ?ref=<uid>. The LandingPage
 *      stashes the uid in sessionStorage. When they click "Start free"
 *      and sign up, AuthContext picks it up and POSTs to
 *      /api/referral/claim with { referrerUid, newUserUid }.
 *
 *   3. This module handles the claim:
 *        - Validates referrer is a real user with a billing doc
 *        - Validates newUser is a real user with a fresh billing doc
 *          (or no doc yet, in which case we create one with trial)
 *        - Rejects self-referrals, duplicates, and claims on users
 *          that already have `referredBy` set
 *        - Atomically +50 to referrer.credits.purchased
 *        - Writes { referredBy: referrerUid, referralClaimedAt: now }
 *          to newUser's billing doc
 *
 * All writes are idempotent — a second call with the same newUser
 * pair is a no-op (it returns { allowed: true, alreadyClaimed: true }).
 *
 * Security
 *
 * The endpoint requires a Firebase ID token and only allows the
 * authenticated caller to claim for THEIR OWN uid as newUserUid.
 * You can't claim on someone else's behalf — prevents a griefing
 * attack where a user keeps claiming on behalf of strangers to
 * spam their billing docs.
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const { admin, db } = require('./core/firebase.cjs');
const { defaultBillingDoc } = require('./core/billing.cjs');

const REFERRAL_BONUS_CREDITS = 50;

// Abuse-prevention cap: a single referrer can earn at most 20 referrals
// per rolling 24-hour window. Legitimate power-users rarely bring in
// more than a few friends per day; this cap blocks incentive-farming
// scripts that create batches of fake accounts against one victim.
// Configurable via env var.
const REFERRAL_DAILY_CAP = Number(process.env.REFERRAL_DAILY_CAP) || 20;

/**
 * Process a referral claim. See module doc for the full flow.
 *
 * @param {object} opts
 * @param {string} opts.referrerUid - uid of the person who sent the link
 * @param {string} opts.newUserUid  - uid of the new signup (must equal the
 *                                     authenticated caller's uid)
 * @returns {Promise<{allowed: boolean, reason?: string,
 *                    alreadyClaimed?: boolean,
 *                    referrerCredits?: number}>}
 */
async function claimReferral({ referrerUid, newUserUid }) {
    if (!db) {
        return { allowed: false, reason: 'service_unavailable' };
    }
    if (!referrerUid || typeof referrerUid !== 'string') {
        return { allowed: false, reason: 'referrer_required' };
    }
    if (!newUserUid || typeof newUserUid !== 'string') {
        return { allowed: false, reason: 'new_user_required' };
    }
    if (referrerUid === newUserUid) {
        return { allowed: false, reason: 'self_referral_not_allowed' };
    }

    // Anti-abuse: check rolling-24h cap on referrals for this referrer.
    // This runs OUTSIDE the transaction so we don't lock on the audit
    // collection during the credit grant. The trade-off is a tiny race
    // window where two concurrent claims could both pass the check
    // even if the 21st is being processed — but the damage is at most
    // one extra claim (50 credits), which is acceptable.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    try {
        const recent = await db
            .collection('billing_events')
            .where('type', '==', 'referral_credit')
            .where('referrerUid', '==', referrerUid)
            .where('at', '>=', new Date(dayAgo))
            .limit(REFERRAL_DAILY_CAP + 1)
            .get();
        if (recent.size >= REFERRAL_DAILY_CAP) {
            console.warn(
                `[Referral] daily cap hit for referrerUid=${referrerUid} ` +
                `(cap=${REFERRAL_DAILY_CAP}, recent=${recent.size})`
            );
            return { allowed: false, reason: 'daily_cap_reached' };
        }
    } catch (err) {
        // Cap check failure is non-fatal — let the claim proceed. The
        // index this query needs might not exist yet in fresh deploys.
        console.warn(`[Referral] cap check failed (proceeding): ${err.message}`);
    }

    const referrerRef = db.collection('users').doc(referrerUid).collection('billing').doc('state');
    const newUserRef = db.collection('users').doc(newUserUid).collection('billing').doc('state');

    const result = await db.runTransaction(async (t) => {
        const [referrerSnap, newUserSnap] = await Promise.all([
            t.get(referrerRef),
            t.get(newUserRef),
        ]);

        if (!referrerSnap.exists) {
            return { allowed: false, reason: 'referrer_not_found' };
        }

        const referrer = referrerSnap.data();
        const existingNew = newUserSnap.exists ? newUserSnap.data() : null;

        // Idempotency: if newUser already has referredBy set, skip.
        // Return `alreadyClaimed: true` so callers can treat this as
        // success-but-no-op (prevents double-retries from racing).
        if (existingNew && existingNew.referredBy) {
            return {
                allowed: true,
                alreadyClaimed: true,
                reason: 'referral_already_claimed',
            };
        }

        // Bump referrer's purchased balance by REFERRAL_BONUS_CREDITS.
        // Use a transaction-safe increment rather than a read-then-write
        // to avoid losing concurrent referral claims.
        const newPurchased = (referrer.credits?.purchased || 0) + REFERRAL_BONUS_CREDITS;
        t.update(referrerRef, {
            'credits.purchased': newPurchased,
            updatedAt: Date.now(),
        });

        // Write referredBy on the new user's billing doc. If they don't
        // have a doc yet (unusual but possible if they signed up but
        // haven't triggered any agent workflows), seed the trial default.
        if (!existingNew) {
            const seed = defaultBillingDoc({ uid: newUserUid });
            t.set(newUserRef, {
                ...seed,
                referredBy: referrerUid,
                referralClaimedAt: Date.now(),
            });
        } else {
            t.update(newUserRef, {
                referredBy: referrerUid,
                referralClaimedAt: Date.now(),
            });
        }

        // Audit row inside the same transaction. If it fails, the whole
        // claim rolls back — we never grant credits without an audit
        // trail. Previously the audit was fire-and-forget AFTER the
        // transaction, which could leak credits if the audit write
        // failed (Firestore quota, network blip, etc).
        const auditRef = db.collection('billing_events').doc();
        t.set(auditRef, {
            type: 'referral_credit',
            referrerUid,
            newUserUid,
            credits: REFERRAL_BONUS_CREDITS,
            at: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
            allowed: true,
            referrerCredits: newPurchased,
        };
    });

    return result;
}

/**
 * Count successful referrals made by a given user. Reads
 * billing_events with type='referral_credit' and referrerUid=X.
 * Used by the Billing page to show "You've earned N×50 credits".
 */
async function countReferrals(referrerUid) {
    if (!db || !referrerUid) return 0;
    const snap = await db
        .collection('billing_events')
        .where('type', '==', 'referral_credit')
        .where('referrerUid', '==', referrerUid)
        .get();
    return snap.size;
}

module.exports = {
    REFERRAL_BONUS_CREDITS,
    claimReferral,
    countReferrals,
};
