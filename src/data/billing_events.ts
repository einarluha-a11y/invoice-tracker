/**
 * Read-side access to the billing_events audit log.
 *
 * Writes are server-side only (spendCredits + webhook handler in
 * billing_service.cjs). Clients just subscribe to their own history
 * and feed it to CreditHistorySection / UsageChart in Billing.tsx.
 *
 * Firestore rules allow users to read their own spend events
 * (type='spend' AND uid == auth.uid). Webhook idempotency docs stay
 * hidden from regular users because they hold cross-customer data.
 */

import { collection, onSnapshot, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type BillingAction =
    | 'ai_extraction'
    | 'bank_reconciliation'
    | 'ai_teacher_rule'
    | 'smart_duplicate_check'
    | 'auto_categorization';

export interface BillingSpendEvent {
    id: string;
    type: 'spend';
    uid: string;
    action: BillingAction;
    units: number;
    cost: number;
    remaining: number;
    at: number; // ms since epoch
}

/**
 * Subscribe to the last N spend events for a given user, newest first.
 * Returns an unsubscribe function.
 *
 * Requires a composite index on (type, uid, at desc). Firestore will
 * emit a `failed-precondition` error with an index-creation link the
 * first time the query runs in a new project — that's expected.
 */
export function subscribeToUserSpends(
    uid: string | null,
    maxItems: number,
    onUpdate: (events: BillingSpendEvent[]) => void,
    onError?: (err: Error) => void
): () => void {
    if (!uid || !db) {
        onUpdate([]);
        return () => {};
    }
    const q = query(
        collection(db, 'billing_events'),
        where('type', '==', 'spend'),
        where('uid', '==', uid),
        orderBy('at', 'desc'),
        limit(maxItems)
    );
    return onSnapshot(
        q,
        (snap) => {
            const events: BillingSpendEvent[] = snap.docs.map((doc) => {
                const d = doc.data();
                const rawAt = d.at;
                const at =
                    rawAt instanceof Timestamp
                        ? rawAt.toMillis()
                        : typeof rawAt === 'number'
                        ? rawAt
                        : 0;
                return {
                    id: doc.id,
                    type: 'spend',
                    uid: d.uid,
                    action: d.action,
                    units: Number(d.units) || 0,
                    cost: Number(d.cost) || 0,
                    remaining: Number(d.remaining) || 0,
                    at,
                };
            });
            onUpdate(events);
        },
        (err) => {
            console.error('[Billing] spends subscription error:', err);
            onError?.(err);
            onUpdate([]);
        }
    );
}

/**
 * Bucket spend events into 30 calendar days (ending today) so a simple
 * bar chart can render them. Days with no spend are still in the output
 * with count=0 so the x-axis is contiguous.
 */
export interface DailyBucket {
    dayIso: string;       // YYYY-MM-DD
    label: string;        // short label for axis
    credits: number;      // total credits spent that day
}

export function bucketByDay(events: BillingSpendEvent[], days = 30): DailyBucket[] {
    const buckets: Record<string, number> = {};
    // Initialise all 30 days with zero
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        const iso = d.toISOString().slice(0, 10);
        buckets[iso] = 0;
    }
    for (const e of events) {
        if (!e.at) continue;
        const d = new Date(e.at);
        d.setUTCHours(0, 0, 0, 0);
        const iso = d.toISOString().slice(0, 10);
        if (iso in buckets) {
            buckets[iso] += e.cost;
        }
    }
    return Object.entries(buckets)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([dayIso, credits]) => ({
            dayIso,
            label: dayIso.slice(5), // MM-DD
            credits,
        }));
}
