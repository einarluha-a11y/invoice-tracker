// dashboard_auditor_agent.cjs — AI duplicate audit DISABLED (Claude removed)
// Duplicate detection is handled by the rule-based check in writeToFirestore (duplicate invoiceId check).

async function runDashboardAudit() {
    console.log('[Dashboard Auditor] ℹ️  AI audit disabled — using rule-based deduplication only.');
}

module.exports = { runDashboardAudit };
