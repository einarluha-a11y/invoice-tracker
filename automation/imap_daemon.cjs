require('dotenv').config({ path: __dirname + '/.env' });

// Global error handlers — prevent crashes from unhandled rejections / protocol error events
process.on('unhandledRejection', (reason, promise) => {
    console.error('[imap-daemon] ⚠️  Unhandled rejection (not crashing):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[imap-daemon] ⚠️  Uncaught exception (not crashing):', err.message);
});

// Modules
const { checkEmailForInvoices, pollAllCompanyInboxes, checkAndRunFlagTasks, pollLoop, loadRateLimitsFromFirestore } = require('./imap_listener.cjs');
const { writeToFirestore, parseInvoiceDataWithAI, scoutTeacherPipeline } = require('./invoice_processor.cjs');
const { reconcilePayment, processBankStatement } = require('./bank_statement_processor.cjs');
const { sweepStatuses, auditLoop } = require('./status_sweeper.cjs');

// Start the process only when run directly (not when imported as a module)
if (require.main === module) {
    checkAndRunFlagTasks().then(async () => {
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
