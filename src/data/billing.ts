/**
 * Billing types + Firestore subscription for users/{uid}/billing/state.
 *
 * This mirrors the server-side shape in automation/core/billing.cjs —
 * if you change fields there, update here too. Tests in
 * automation/tests/billing.test.cjs pin the contract.
 */

import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export type PlanId = 'free' | 'pro' | 'business';
export type BillingCycle = 'monthly' | 'annual';

export interface BillingCredits {
    limit: number;
    used: number;
    purchased: number;
    resetAt: number | null;
}

export interface BillingTrial {
    active: boolean;
    endsAt: number | null;
}

export interface BillingMigrationMeta {
    grandfatherBonus: number;
    reason: 'existing_user_grandfather';
    policyVersion: number;
}

export interface BillingDoc {
    uid: string;
    /** Email copied from the user's Firebase Auth profile at migration
     *  or signup time. Used by AdminBilling to show a friendly label
     *  next to the uid. Optional because older docs may not have it. */
    email?: string | null;
    plan: PlanId;
    billingCycle: BillingCycle;
    credits: BillingCredits;
    trial: BillingTrial;
    lemonSqueezy: {
        customerId: string | null;
        subscriptionId: string | null;
        variantId: number | null;
    };
    paymentFailed?: boolean;
    cancellationReason?: 'cancelled' | 'expired' | null;
    /** When present, this user came from the grandfather migration
     *  run and received the one-time bonus credit grant. */
    migration?: BillingMigrationMeta;
    /** Set by referral_service.claimReferral when a user signs up
     *  via another user's /landing?ref=... URL. */
    referredBy?: string;
    referralClaimedAt?: number;
    migratedAt?: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * Default client-side billing state for users who don't have a doc yet.
 * The backend writes the real doc via webhook; until the user is migrated
 * or signs up, the UI shows this "guest" snapshot so nothing crashes.
 */
export function emptyBillingDoc(uid: string): BillingDoc {
    return {
        uid,
        plan: 'free',
        billingCycle: 'monthly',
        credits: { limit: 50, used: 0, purchased: 0, resetAt: null },
        trial: { active: false, endsAt: null },
        lemonSqueezy: { customerId: null, subscriptionId: null, variantId: null },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

/**
 * Subscribe to live updates of the user's billing doc. Returns an
 * unsubscribe function (call on component unmount).
 *
 * Gracefully returns a no-op unsubscriber if Firestore isn't configured
 * or the uid is missing — callers don't need to branch on that.
 */
export function subscribeToBilling(
    uid: string | null,
    onUpdate: (billing: BillingDoc | null) => void,
    onError?: (err: Error) => void
): () => void {
    if (!uid || !db) {
        onUpdate(null);
        return () => {};
    }
    const ref = doc(db, 'users', uid, 'billing', 'state');
    return onSnapshot(
        ref,
        (snap) => {
            if (!snap.exists()) {
                onUpdate(null);
                return;
            }
            onUpdate(snap.data() as BillingDoc);
        },
        (err) => {
            console.error('[Billing] subscription error:', err);
            onError?.(err);
            onUpdate(null);
        }
    );
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/**
 * Total credits available to spend right now (monthly pool + purchased
 * one-time packs). This is what the "remaining" number on the UI shows.
 */
export function creditsAvailable(billing: BillingDoc | null): number {
    if (!billing) return 0;
    const c = billing.credits;
    return Math.max(0, c.limit - c.used) + (c.purchased || 0);
}

/**
 * Percentage of monthly budget already spent (0–1). Only counts the
 * monthly pool, not purchased credits — the UI shows a separate tally
 * for those.
 */
export function monthlyUsagePct(billing: BillingDoc | null): number {
    if (!billing || !billing.credits || billing.credits.limit === 0) return 0;
    return Math.min(1, billing.credits.used / billing.credits.limit);
}

/**
 * Human-readable label for each plan. i18n keys live in src/i18n.ts as
 * `billing.plan.{id}`, this function just returns the raw id → display
 * name mapping for fallback situations.
 */
export const PLAN_DISPLAY_NAMES: Record<PlanId, string> = {
    free: 'FREE',
    pro: 'PRO',
    business: 'BUSINESS',
};

/**
 * Lemon Squeezy checkout URLs are set via env vars so we can swap test
 * mode for prod without a code change. Returns null until Einar fills
 * them in — the UI will grey out the Upgrade button in that case.
 *
 * Expected env keys:
 *   VITE_LEMON_CHECKOUT_PRO_MONTHLY
 *   VITE_LEMON_CHECKOUT_PRO_ANNUAL
 *   VITE_LEMON_CHECKOUT_BUSINESS_MONTHLY
 *   VITE_LEMON_CHECKOUT_BUSINESS_ANNUAL
 *   VITE_LEMON_CHECKOUT_CREDITS_100
 *   VITE_LEMON_CHECKOUT_CREDITS_500
 *   VITE_LEMON_CHECKOUT_CREDITS_1000
 */
export function getCheckoutUrl(
    target: 'pro_monthly' | 'pro_annual' | 'business_monthly' | 'business_annual' |
            'credits_100' | 'credits_500' | 'credits_1000',
    uid: string
): string | null {
    const envKey = `VITE_LEMON_CHECKOUT_${target.toUpperCase()}`;
    // Vite env is readonly; fall back through import.meta.env
    const base = (import.meta.env as Record<string, string | undefined>)[envKey];
    if (!base) return null;
    // Pass uid as custom_data so the webhook can identify the user
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}checkout[custom][uid]=${encodeURIComponent(uid)}`;
}
