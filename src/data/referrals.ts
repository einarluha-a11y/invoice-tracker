/**
 * Frontend helpers for the referral program.
 *
 *   stashRefFromUrl()  — landing page calls this on mount to catch
 *                         any ?ref=<uid> query param and store it in
 *                         sessionStorage. Survives page navigation
 *                         but clears when the browser tab closes.
 *
 *   consumeStashedRef() — AuthContext calls this on first-time
 *                         signup to atomically claim the referral
 *                         via the backend. Returns the result so the
 *                         signup flow can show a toast like "+50
 *                         credits earned by Einar".
 *
 *   getReferralStats() — Billing page uses this to display how many
 *                         referrals the current user has earned.
 */

import { authHeaders } from './api';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const STORAGE_KEY = 'pendingReferralUid';

/**
 * Extract ?ref=<uid> from the current URL and stash it in
 * sessionStorage for later consumption. Called from LandingPage.tsx
 * on mount. Ignores invalid-looking values.
 */
export function stashRefFromUrl(): void {
    if (typeof window === 'undefined') return;
    try {
        const url = new URL(window.location.href);
        const ref = url.searchParams.get('ref');
        if (!ref) return;
        // Firebase uids are alphanumeric + underscore/dash, 28 chars.
        // Reject anything that doesn't look like one.
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(ref)) return;
        sessionStorage.setItem(STORAGE_KEY, ref);
    } catch {
        // ignore — some browsers throw on sessionStorage in private mode
    }
}

/**
 * Read + clear the stashed referral uid. Returns null if nothing
 * was stashed.
 */
export function readStashedRef(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

export function clearStashedRef(): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore
    }
}

export interface ClaimResult {
    allowed: boolean;
    reason?: string;
    alreadyClaimed?: boolean;
    referrerCredits?: number;
}

/**
 * Consume any stashed ref by calling /api/referral/claim. Safe to
 * call on every signup path — if nothing is stashed or the claim
 * fails, it's a no-op. Clears the stash on success to prevent
 * repeated claims.
 */
export async function consumeStashedRef(newUserUid: string): Promise<ClaimResult | null> {
    const referrerUid = readStashedRef();
    if (!referrerUid) return null;
    if (referrerUid === newUserUid) {
        clearStashedRef();
        return null; // self-referral — silently drop
    }

    try {
        const headers = {
            ...(await authHeaders()),
            'Content-Type': 'application/json',
        };
        const r = await fetch(`${API_BASE}/api/referral/claim`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ referrerUid, newUserUid }),
        });
        const data = await r.json();
        // Clear the stash on any response — successful or terminal.
        // A "referrer not found" error means the ref is bogus and
        // there's no point keeping it around.
        clearStashedRef();
        if (!r.ok) {
            console.warn('[Referral] claim rejected:', data.error);
            return { allowed: false, reason: data.error };
        }
        return data;
    } catch (err: any) {
        console.warn('[Referral] claim failed:', err?.message || err);
        return { allowed: false, reason: 'network_error' };
    }
}

export interface ReferralStats {
    count: number;
    bonusPerReferral: number;
    totalEarned: number;
}

export async function getReferralStats(): Promise<ReferralStats> {
    try {
        const headers = await authHeaders();
        const r = await fetch(`${API_BASE}/api/referral/stats`, { headers });
        if (!r.ok) return { count: 0, bonusPerReferral: 50, totalEarned: 0 };
        return r.json();
    } catch {
        return { count: 0, bonusPerReferral: 50, totalEarned: 0 };
    }
}

/**
 * Build the user's own referral URL. Points at /landing so new users
 * see the marketing page first (where the ?ref gets stashed) rather
 * than landing directly on the login screen.
 */
export function buildReferralUrl(uid: string): string {
    if (typeof window === 'undefined') {
        return `https://invoice-tracker-backend-production.up.railway.app/landing?ref=${encodeURIComponent(uid)}`;
    }
    const origin = window.location.origin;
    return `${origin}/landing?ref=${encodeURIComponent(uid)}`;
}
