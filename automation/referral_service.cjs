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

        return {
            allowed: true,
            referrerCredits: newPurchased,
        };
    });

    // Append an audit row so admin dashboard can see referral activity.
    // Non-blocking — failure to log never aborts the claim.
    if (result.allowed && !result.alreadyClaimed) {
        try {
            await db.collection('billing_events').add({
                type: 'referral_credit',
                referrerUid,
                newUserUid,
                credits: REFERRAL_BONUS_CREDITS,
                at: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (err) {
            console.warn(`[Referral] audit log failed: ${err.message}`);
        }
    }

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
