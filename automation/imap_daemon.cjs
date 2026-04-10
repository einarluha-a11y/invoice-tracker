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
    if (code !== 0) console.error('[imap-daemon] 🔴 Process exiting with code', code);
});

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
            await loadRateLimitsFromFirestore();
            pollLoop();
            auditLoop();
        });
}

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
