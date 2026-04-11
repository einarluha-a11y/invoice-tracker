require('dotenv').config({ path: __dirname + '/.env' });

// Firebase Admin Initialization (Shared Core)
const { admin, db } = require('./core/firebase.cjs');
const { runDashboardAudit } = require('./dashboard_auditor_agent.cjs');

// ─── Automatic Status Sweep ─────────────────────────────────────────────────
// Runs every 2 hours. Bidirectional self-healing based on current dueDate:
//   Pending → Overdue: if dueDate < today
//   Overdue → Pending: if dueDate >= today (happens when dueDate was corrected
//                      by Teacher charter rule or manual edit after stale Overdue)
//
// STATUS RULES (3 statuses only):
//   Paid    — set ONLY by reconcilePayment() when bank statement arrives with matching payment
//   Overdue — dueDate < today, not paid
//   Pending — dueDate >= today or no dueDate, not paid
//
async function sweepStatuses() {
    const today = new Date().toISOString().slice(0, 10);
    const snap = await db.collection('invoices').get();
    let toOverdue = 0, toPending = 0, txConflicts = 0;

    // ── M6: each status flip is wrapped in runTransaction ──────────────────
    // Why: between the snapshot read above and the .update() write below,
    // another process (manual edit through the dashboard, Repairman flag,
    // bank reconciliation marking Paid, etc.) may have already changed the
    // status. Without a transaction, our raw .update would silently revert
    // someone else's recent decision — e.g. flipping a freshly-Paid invoice
    // back to Overdue if its dueDate is in the past.
    //
    // The transaction re-reads the doc inside the tx, re-checks the
    // condition against the FRESH data, and only writes if the precondition
    // still holds. Conflicting writes lose to whoever ran first.
    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.status === 'Paid' || data.status === 'Duplicate') continue;

        // Decide intent OUTSIDE the transaction (cheap), then re-validate INSIDE.
        let intent = null;
        if (data.status !== 'Overdue' && data.dueDate && data.dueDate < today) {
            intent = 'Overdue';
        } else if (data.status === 'Overdue' && data.dueDate && data.dueDate >= today) {
            intent = 'Pending';
        }
        if (!intent) continue;

        try {
            await db.runTransaction(async (t) => {
                const fresh = await t.get(doc.ref);
                if (!fresh.exists) return;
                const freshData = fresh.data();

                // Skip if someone else already flipped status (e.g. to Paid)
                if (freshData.status === 'Paid' || freshData.status === 'Duplicate') return;

                // Re-evaluate the condition against fresh data
                if (intent === 'Overdue') {
                    if (freshData.status === 'Overdue') return; // already done
                    if (!freshData.dueDate || freshData.dueDate >= today) return; // condition no longer holds
                    t.update(doc.ref, {
                        status: 'Overdue',
                        previousStatus: freshData.status,
                        statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                } else if (intent === 'Pending') {
                    if (freshData.status !== 'Overdue') return;
                    if (!freshData.dueDate || freshData.dueDate < today) return;
                    t.update(doc.ref, {
                        status: 'Pending',
                        previousStatus: 'Overdue',
                        statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            });
            if (intent === 'Overdue') toOverdue++;
            else if (intent === 'Pending') toPending++;
        } catch (err) {
            // Firestore retries the tx automatically up to 5 times. If it
            // still fails, we just skip this doc this round — next sweep
            // will pick it up.
            txConflicts++;
            console.warn(`[Status Sweep] tx conflict on ${doc.id}: ${err.message}`);
        }
    }

    if (toOverdue > 0 || toPending > 0 || txConflicts > 0) {
        const tail = txConflicts > 0 ? ` (${txConflicts} tx conflicts)` : '';
        console.log(`[Status Sweep] ${toOverdue} → Overdue, ${toPending} → Pending (self-healed after dueDate correction)${tail}`);
    }
}

// ─── Weekly orphan cleanup (M3) ─────────────────────────────────────────────
// Every iteration of auditLoop runs every 2h. We want orphan cleanup at most
// once a week, so we persist `lastRunAt` in Firestore config/orphan_cleanup
// and skip until 7 days have passed. Always dry-run-by-default — actual
// deletion requires the operator to run `node automation/orphan_cleanup.cjs --delete`
// manually after reviewing the dry-run report. This avoids surprise deletes
// from a cron job.
async function runOrphanCleanupIfDue() {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    try {
        const ref = db.collection('config').doc('orphan_cleanup');
        const snap = await ref.get();
        const last = snap.exists ? snap.data().lastRunAt : null;
        const lastMs = last && last.toMillis ? last.toMillis() : 0;
        if (lastMs && (Date.now() - lastMs) < ONE_WEEK_MS) {
            return; // not due yet
        }
        console.log('[Orphan Cleanup] Weekly scan due — running dry-run report...');
        const { runOrphanCleanup } = require('./orphan_cleanup.cjs');
        const result = await runOrphanCleanup({ dryRun: true });
        await ref.set({
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastResult: result,
        });
        if (result.orphans > 0) {
            console.log(`[Orphan Cleanup] Found ${result.orphans} orphans — review with: node automation/orphan_cleanup.cjs --delete`);
        }
    } catch (err) {
        console.warn(`[Orphan Cleanup] Skipped: ${err.message}`);
    }
}

// Overlap-safe Post-Flight Auditor daemon
console.log('Dashboard Auditor Scheduled. Sweeping database every 2 hours...');
async function auditLoop() {
    // Initial delay so it doesn't run concurrently with the first IMAP poll
    await new Promise(resolve => setTimeout(resolve, 60000));
    while (true) {
        try {
            await runDashboardAudit();
            await sweepStatuses();
            await runOrphanCleanupIfDue();
        } catch (err) {
            console.error('[Audit Loop Error] Critical failure in Auditor daemon:', err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 7200000));
    }
}

module.exports = { sweepStatuses, auditLoop, runOrphanCleanupIfDue };
