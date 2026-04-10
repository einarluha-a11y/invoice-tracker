/**
 * ERROR REPORTER — Invoice-Tracker Backend
 * Logs critical errors to a file and optionally sends webhook alerts.
 *
 * Usage:
 *   const { reportError } = require('./error_reporter.cjs');
 *   await reportError('IMAP_AUTH_FAILED', 'invoices@gltechnics.com', err);
 */

const fs = require('fs');
const path = require('path');
const { admin, db } = require('./core/firebase.cjs');

const ERROR_LOG = path.join(__dirname, '..', 'backend_errors.log');
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB — rotate when exceeded
const MAX_ROTATED_FILES = 5;                 // Keep last 5 rotated files

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

    // Rotate log if too large — keeps last MAX_ROTATED_FILES backups
    try {
        const stat = fs.existsSync(ERROR_LOG) ? fs.statSync(ERROR_LOG) : null;
        if (stat && stat.size > MAX_LOG_SIZE_BYTES) {
            // Shift existing rotated files: .old.4 → deleted, .old.3 → .old.4, etc.
            for (let n = MAX_ROTATED_FILES - 1; n >= 1; n--) {
                const older = `${ERROR_LOG}.old.${n}`;
                const newer = `${ERROR_LOG}.old.${n + 1}`;
                if (fs.existsSync(older)) {
                    if (n === MAX_ROTATED_FILES - 1 && fs.existsSync(newer)) fs.unlinkSync(newer);
                    fs.renameSync(older, newer);
                }
            }
            fs.renameSync(ERROR_LOG, `${ERROR_LOG}.old.1`);
        }
        fs.appendFileSync(ERROR_LOG, entry);
    } catch (logErr) {
        console.error('[ErrorReporter] Failed to write error log:', logErr.message);
    }

    // Attempt to broadcast securely to the Firestore UI dashboard
    // TTL: keep only the most recent MAX_SYSTEM_LOG_ENTRIES entries (oldest deleted on write)
    const MAX_SYSTEM_LOG_ENTRIES = 200;
    try {
        if (db) {
            const logsRef = db.collection('system_logs');
            // Truncate message to avoid oversized documents (Firestore 1 MiB doc limit)
            const safeMessage = message.length > 4000 ? message.slice(0, 4000) + '…[truncated]' : message;
            await logsRef.add({
                errorCode,
                context,
                message: safeMessage,
                timestamp,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            // Prune oldest entries when collection exceeds the cap.
            // Use .select('createdAt') to fetch minimal field data — avoids "Transaction too big"
            // when documents have large message fields.
            const totalSnap = await logsRef.count().get();
            if (totalSnap.data().count > MAX_SYSTEM_LOG_ENTRIES) {
                const excess = Math.min(totalSnap.data().count - MAX_SYSTEM_LOG_ENTRIES, 100);
                const oldSnap = await logsRef.orderBy('createdAt', 'asc').limit(excess).select('createdAt').get();
                // Firestore batch limit is 500 ops — use small chunk to stay within transaction size
                const CHUNK = 100;
                for (let i = 0; i < oldSnap.docs.length; i += CHUNK) {
                    const batch = db.batch();
                    oldSnap.docs.slice(i, i + CHUNK).forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                }
            }
        } else {
             console.error('[Dead-Man Switch] Firestore connection is totally offline. UI logging bypassed.');
        }
    } catch (fsErr) {
        console.error('[Dead-Man Switch] Firestore write crashed. Escalating to external webhook...', fsErr.message);
    }

    console.error(`[ErrorReporter] 🚨 ${errorCode}: ${context} — ${message}`);

    // Send webhook if configured
    if (WEBHOOK_URL) {
        try {
            const https = require('https');
            const url = require('url');
            const stack = (err instanceof Error && err.stack) ? `\nStack: ${err.stack.split('\n').slice(0, 4).join(' | ')}` : '';
            const body = JSON.stringify({
                text: `🚨 Invoice-Tracker Error\n*${errorCode}*\nContext: ${context}\nMessage: ${message}${stack}\nTime: ${timestamp}`
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
                req.on('error', (e) => {
                    console.warn('[ErrorReporter] ⚠️  Webhook delivery failed:', e.message);
                    resolve(); // Don't crash on webhook failure
                });
                req.write(body);
                req.end();
            });
        } catch (webhookErr) {
            console.warn('[ErrorReporter] ⚠️  Webhook send threw:', webhookErr.message);
        }
    }
}

module.exports = { reportError };
