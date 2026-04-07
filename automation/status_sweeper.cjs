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
    let toOverdue = 0, toPending = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.status === 'Paid' || data.status === 'Duplicate') continue;

        // Pending → Overdue
        if (data.status !== 'Overdue' && data.dueDate && data.dueDate < today) {
            await doc.ref.update({
                status: 'Overdue',
                previousStatus: data.status,
                statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            toOverdue++;
            continue;
        }

        // Overdue → Pending (self-healing after dueDate correction)
        if (data.status === 'Overdue' && data.dueDate && data.dueDate >= today) {
            await doc.ref.update({
                status: 'Pending',
                previousStatus: 'Overdue',
                statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            toPending++;
        }
    }
    if (toOverdue > 0 || toPending > 0) {
        console.log(`[Status Sweep] ${toOverdue} → Overdue, ${toPending} → Pending (self-healed after dueDate correction)`);
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
        } catch (err) {
            console.error('[Audit Loop Error] Critical failure in Auditor daemon:', err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 7200000));
    }
}

module.exports = { sweepStatuses, auditLoop };
