require('dotenv').config({ path: __dirname + '/.env' });

// Modules
const { checkEmailForInvoices, pollAllCompanyInboxes, checkAndRunFlagTasks, pollLoop } = require('./imap_listener.cjs');
const { writeToFirestore, parseInvoiceDataWithAI, scoutTeacherPipeline } = require('./invoice_processor.cjs');
const { reconcilePayment, processBankStatement } = require('./bank_statement_processor.cjs');
const { sweepStatuses, auditLoop } = require('./status_sweeper.cjs');

// Start the process only when run directly (not when imported as a module)
if (require.main === module) {
    checkAndRunFlagTasks().then(() => {
        pollLoop();
        auditLoop();
    });
}

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
