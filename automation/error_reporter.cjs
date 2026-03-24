/**
 * ERROR REPORTER — Invoice Tracker Backend
 * Logs critical errors to a file and optionally sends webhook alerts.
 *
 * Usage:
 *   const { reportError } = require('./error_reporter.cjs');
 *   await reportError('IMAP_AUTH_FAILED', 'invoices@gltechnics.com', err);
 */

const fs = require('fs');
const path = require('path');

const ERROR_LOG = path.join(__dirname, '..', 'backend_errors.log');
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB — rotate when exceeded

// Optional: set ALERT_WEBHOOK_URL in .env to receive POST notifications
// e.g. a Slack webhook, Discord webhook, or custom endpoint
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;

/**
 * Report a critical error.
 * @param {string} errorCode - Short machine-readable code (e.g. 'IMAP_AUTH_FAILED')
 * @param {string} context - Human-readable context (e.g. email address, company name)
 * @param {Error|string} err - The error object or message
 */
async function reportError(errorCode, context, err) {
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    const entry = `[${timestamp}] ${errorCode} | ${context} | ${message}\n`;

    // Rotate log if too large
    try {
        const stat = fs.existsSync(ERROR_LOG) ? fs.statSync(ERROR_LOG) : null;
        if (stat && stat.size > MAX_LOG_SIZE_BYTES) {
            fs.renameSync(ERROR_LOG, ERROR_LOG + '.old');
        }
        fs.appendFileSync(ERROR_LOG, entry);
    } catch (logErr) {
        console.error('[ErrorReporter] Failed to write error log:', logErr.message);
    }

    console.error(`[ErrorReporter] 🚨 ${errorCode}: ${context} — ${message}`);

    // Send webhook if configured
    if (WEBHOOK_URL) {
        try {
            const https = require('https');
            const url = require('url');
            const body = JSON.stringify({
                text: `🚨 Invoice Tracker Error\n*${errorCode}*\nContext: ${context}\nMessage: ${message}\nTime: ${timestamp}`
            });
            const parsed = new url.URL(WEBHOOK_URL);
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            };
            await new Promise((resolve) => {
                const req = https.request(options, () => resolve());
                req.on('error', () => resolve()); // Don't crash on webhook failure
                req.write(body);
                req.end();
            });
        } catch (_) {}
    }
}

module.exports = { reportError };
