require('dotenv').config({ path: __dirname + '/.env' });

// Global error handlers — prevent crashes from unhandled rejections / protocol error events
process.on('unhandledRejection', (reason, promise) => {
    const msg = (reason instanceof Error) ? reason.message : String(reason ?? 'unknown');
    console.error('[imap-daemon] ⚠️  Unhandled rejection (not crashing):', msg);
});
process.on('uncaughtException', (err) => {
    const msg = (err instanceof Error) ? err.message : String(err ?? 'unknown');
    console.error('[imap-daemon] ⚠️  Uncaught exception (not crashing):', msg);
});
process.on('exit', (code) => {
    // Log ALL exits — including clean 0 exits that may indicate event-loop drain.
    console.error('[imap-daemon] 🔴 Process exiting with code', code);
});

// Keepalive: prevents event-loop drain when all IMAP accounts are rate-limited
// and async ops complete too fast (Firebase calls return immediately on network flap).
// Without this: event loop empties → Node exits (code 0) → PM2 restarts → crash loop.
const _keepAlive = setInterval(() => {}, 60000);

// Modules
const { checkEmailForInvoices, pollAllCompanyInboxes, checkAndRunFlagTasks, pollLoop, loadRateLimitsFromFirestore } = require('./imap_listener.cjs');
const { writeToFirestore, parseInvoiceDataWithAI, scoutTeacherPipeline } = require('./invoice_processor.cjs');
const { reconcilePayment, processBankStatement } = require('./bank_statement_processor.cjs');
const { sweepStatuses, auditLoop } = require('./status_sweeper.cjs');

// Start the process only when run directly (not when imported as a module)
if (require.main === module) {
    // CRITICAL: .catch() ensures pollLoop/auditLoop always start even if flag tasks fail.
    // Without it: checkAndRunFlagTasks() rejection → unhandledRejection handler logs it
    // → pollLoop never called → event loop empty → Node exits → PM2 restarts → crash loop.
    checkAndRunFlagTasks()
        .catch(err => {
            // Use safe stringify — err may be null/non-Error (same pattern as unhandledRejection handler).
            // If .catch() itself throws, .then() is never called → pollLoop never starts → crash loop.
            const msg = (err instanceof Error) ? err.message : String(err ?? 'unknown');
            console.error('[imap-daemon] ⚠️  Flag tasks failed (non-fatal, starting loops anyway):', msg);
        })
        .then(async () => {
            // Restore IMAP bans from Firestore before first poll.
            // Local file is ephemeral on Railway — Firestore is the only source of truth
            // that survives container restarts. Without this, rate-limited accounts would
            // be retried immediately on each restart, causing the crash loop.
            // Timeout guard: if Firestore hangs, don't block pollLoop forever.
            const RESTORE_TIMEOUT_MS = 8000;
            await Promise.race([
                loadRateLimitsFromFirestore(),
                new Promise(resolve => setTimeout(() => {
                    console.warn('[imap-daemon] ⚠️  loadRateLimitsFromFirestore timed out — starting loops anyway');
                    resolve();
                }, RESTORE_TIMEOUT_MS)),
            ]);
            pollLoop();
            auditLoop();
        });
}

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
