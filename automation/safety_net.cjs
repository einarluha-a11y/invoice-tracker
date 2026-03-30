/**
 * SAFETY NET AGENT
 *
 * NEEDS_REVIEW / KARANTIIN status has been removed from the system.
 *
 * safetyNetSave() now always returns null — pipeline failures are logged only.
 * The email is not written to processed_email_uids on failure, so the IMAP
 * daemon will naturally retry it on the next sweep cycle.
 */

async function safetyNetSave(rawData, reason, companyId, fileUrl = null) {
    console.warn(`[Safety Net] ⚠️  Pipeline failed for: ${rawData.vendorName || 'unknown'} | Reason: ${reason}`);
    console.warn(`[Safety Net]    → Email will be retried on next IMAP sweep (UID not marked as processed).`);
    return null;
}

module.exports = { safetyNetSave };
