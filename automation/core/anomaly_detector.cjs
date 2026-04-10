/**
 * Anomaly Detector — flag invoices that look statistically or semantically odd.
 *
 * Two layers:
 *
 *   1. Statistical (Z-score over 12 months of vendor history)
 *      • |z| > 3   → score 0.95, route to NEEDS_REVIEW
 *      • |z| > 2   → score 0.70, badge in UI but allow through
 *      • Otherwise → 0.0
 *      Requires at least 4 historical invoices to be meaningful.
 *
 *   2. Semantic (rule-based "smells funny" checks)
 *      • new vendor (zero history)         +0.5  (informational, not blocking)
 *      • round + large amount               +0.2
 *      • duplicate amount in last 7 days    +0.3
 *      • dueDate < dateCreated              +1.0  (always blocks — never legal)
 *
 * Final score is clamped to [0, 1]. Reasons are returned as a string array
 * so the UI can show a tooltip.
 *
 * Used by: invoice_processor.cjs (after Teacher, before Firestore write)
 */

'use strict';

// History window for statistical baseline
const HISTORY_WINDOW_DAYS = 365;
// Z-score thresholds
const Z_HIGH = 3.0;   // hard-flag → NEEDS_REVIEW
const Z_MEDIUM = 2.0; // soft-flag → badge only
// Minimum samples before we trust a baseline
const MIN_HISTORY_SAMPLES = 4;
// Round-number heuristic: amount divisible by 100 AND >= 1000
const ROUND_NUMBER_DIVISOR = 100;
const ROUND_NUMBER_MIN = 1000;
// Max time delta for "duplicate amount" check
const DUP_AMOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute mean and standard deviation of a numeric array.
 * Returns { mean, stddev, count }. Stddev is the *sample* stddev (n-1).
 */
function meanStddev(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, stddev: 0, count: 0 };
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / n;
    if (n < 2) return { mean, stddev: 0, count: n };
    let sq = 0;
    for (const v of values) sq += (v - mean) * (v - mean);
    const stddev = Math.sqrt(sq / (n - 1));
    return { mean, stddev, count: n };
}

/**
 * Compute Z-score. Returns 0 when stddev is 0 (degenerate case).
 */
function zScore(value, mean, stddev) {
    if (!stddev || stddev === 0) return 0;
    return (value - mean) / stddev;
}

/**
 * Load vendor history from Firestore. Returns an array of historical invoices
 * the same vendor has issued in the last HISTORY_WINDOW_DAYS days for the same
 * companyId, sorted by dateCreated descending.
 *
 * Excludes the invoice currently being scored (if it has an `id`).
 */
async function loadVendorHistory(db, vendorName, companyId, excludeId = null) {
    if (!db || !vendorName) return [];

    try {
        let q = db.collection('invoices')
            .where('vendorName', '==', vendorName);

        if (companyId) {
            q = q.where('companyId', '==', companyId);
        }

        // Cap reads — vendor history rarely needs more than ~30 invoices
        // for a stable baseline, and large vendors would otherwise pull
        // hundreds of docs into memory on every new invoice.
        const snap = await q.limit(100).get();

        const cutoff = Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const out = [];

        for (const doc of snap.docs) {
            if (excludeId && doc.id === excludeId) continue;
            const d = doc.data();
            // Date filter — `dateCreated` is YYYY-MM-DD string in Firestore
            if (d.dateCreated) {
                const t = Date.parse(d.dateCreated);
                if (!isNaN(t) && t < cutoff) continue;
            }
            // Skip credit notes (negative amounts) — they distort the baseline
            const amt = Number(d.amount);
            if (!isFinite(amt) || amt <= 0) continue;
            out.push({
                id: doc.id,
                amount: amt,
                taxAmount: Number(d.taxAmount) || 0,
                subtotalAmount: Number(d.subtotalAmount) || 0,
                dateCreated: d.dateCreated,
            });
        }

        return out;
    } catch (err) {
        console.warn(`[AnomalyDetector] Failed to load vendor history for ${vendorName}: ${err.message}`);
        return [];
    }
}

/**
 * Score the statistical anomaly of `invoice.amount` against history.
 * Returns { score, zScore, reasons[] }.
 */
function scoreStatistical(invoice, history) {
    const reasons = [];
    if (!invoice || typeof invoice.amount !== 'number' || invoice.amount <= 0) {
        return { score: 0, zScore: 0, reasons };
    }
    if (history.length < MIN_HISTORY_SAMPLES) {
        return { score: 0, zScore: 0, reasons };
    }

    const amounts = history.map(h => h.amount);
    const stats = meanStddev(amounts);
    const z = zScore(invoice.amount, stats.mean, stats.stddev);
    const absZ = Math.abs(z);

    if (absZ >= Z_HIGH) {
        reasons.push(
            `Amount ${invoice.amount.toFixed(2)} is ${absZ.toFixed(1)} stddev from vendor mean ${stats.mean.toFixed(2)} (n=${stats.count})`
        );
        return { score: 0.95, zScore: z, reasons };
    }
    if (absZ >= Z_MEDIUM) {
        reasons.push(
            `Amount ${invoice.amount.toFixed(2)} is ${absZ.toFixed(1)} stddev from vendor mean ${stats.mean.toFixed(2)} (n=${stats.count})`
        );
        return { score: 0.70, zScore: z, reasons };
    }

    return { score: 0, zScore: z, reasons };
}

/**
 * Score semantic / rule-based anomalies. Returns { score, reasons[] }.
 * Score is additive but clamped to 1.
 */
function scoreSemantic(invoice, history) {
    const reasons = [];
    let score = 0;

    // 1. New vendor (no history) — informational only.
    if (history.length === 0) {
        score += 0.5;
        reasons.push('First invoice from this vendor — no historical baseline');
    }

    // 2. Round + large amount (manual entry / suspicious round number)
    if (
        typeof invoice.amount === 'number' &&
        invoice.amount >= ROUND_NUMBER_MIN &&
        invoice.amount % ROUND_NUMBER_DIVISOR === 0
    ) {
        score += 0.2;
        reasons.push(`Round amount ${invoice.amount} ≥ ${ROUND_NUMBER_MIN}`);
    }

    // 3. Duplicate amount in the last 7 days from same vendor
    if (history.length > 0 && typeof invoice.amount === 'number') {
        const now = invoice.dateCreated ? Date.parse(invoice.dateCreated) : Date.now();
        if (!isNaN(now)) {
            const recentDup = history.find(h => {
                if (!h.dateCreated) return false;
                const t = Date.parse(h.dateCreated);
                if (isNaN(t)) return false;
                return Math.abs(now - t) <= DUP_AMOUNT_WINDOW_MS &&
                       Math.abs(h.amount - invoice.amount) < 0.01;
            });
            if (recentDup) {
                score += 0.3;
                reasons.push(`Same amount ${invoice.amount} from this vendor on ${recentDup.dateCreated}`);
            }
        }
    }

    // 4. dueDate before dateCreated → always block (never legal)
    if (invoice.dateCreated && invoice.dueDate) {
        const dc = Date.parse(invoice.dateCreated);
        const dd = Date.parse(invoice.dueDate);
        if (!isNaN(dc) && !isNaN(dd) && dd < dc) {
            score = 1.0;
            reasons.push(`dueDate ${invoice.dueDate} is before dateCreated ${invoice.dateCreated}`);
        }
    }

    if (score > 1) score = 1;
    return { score, reasons };
}

/**
 * High-level entry point: score statistical + semantic anomalies, return
 * a single composite score and union of reasons.
 *
 * Routing rules:
 *   • score >= 0.9 → caller should set status = NEEDS_REVIEW
 *   • 0.5 <= score < 0.9 → soft flag, keep status, surface in UI
 *   • score < 0.5 → ignore
 *
 * Returns:
 *   {
 *     score: number 0..1,
 *     zScore: number,
 *     reasons: string[],
 *     blocking: boolean,         // score >= 0.9
 *     historyCount: number       // useful for diagnostics
 *   }
 */
async function detectAnomalies(db, invoice, opts = {}) {
    const result = { score: 0, zScore: 0, reasons: [], blocking: false, historyCount: 0 };
    if (!invoice) return result;

    const companyId = opts.companyId || invoice.companyId || null;
    const excludeId = opts.excludeId || invoice.id || null;

    let history = [];
    if (db && invoice.vendorName) {
        history = await loadVendorHistory(db, invoice.vendorName, companyId, excludeId);
    }
    result.historyCount = history.length;

    const stat = scoreStatistical(invoice, history);
    const sem  = scoreSemantic(invoice, history);

    // Composite: take the larger of (statistical, semantic) so a single
    // strong signal isn't averaged into nothing. Add the smaller one in
    // at half weight so multiple weak signals can still escalate.
    const big = Math.max(stat.score, sem.score);
    const small = Math.min(stat.score, sem.score);
    result.score = Math.min(1, big + small * 0.5);
    result.zScore = stat.zScore;
    result.reasons = [...stat.reasons, ...sem.reasons];
    result.blocking = result.score >= 0.9;

    return result;
}

module.exports = {
    detectAnomalies,
    loadVendorHistory,
    scoreStatistical,
    scoreSemantic,
    meanStddev,
    zScore,
    HISTORY_WINDOW_DAYS,
    Z_HIGH,
    Z_MEDIUM,
    MIN_HISTORY_SAMPLES,
};
