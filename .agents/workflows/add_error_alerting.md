---
name: Add Error Alerting System
description: Currently when the invoice processing backend crashes or has critical errors, there is no notification. Add a simple error alerting mechanism that logs critical failures to a file and optionally sends a webhook notification.
priority: LOW
triggers:
  - manual
---

// turbo-all

# TASK: Add Error Alerting System

## Problem

The invoice-bot backend currently runs silently. If it crashes or encounters
critical errors (IMAP auth failure, Firebase unreachable, AI API down), there
is no way to know except checking `pm2 logs invoice-bot` manually.

## Fix

### Step 1 — Create automation/error_reporter.cjs

Create a new file `automation/error_reporter.cjs` with this content:

```js
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
                text: `🚨 Invoice-Tracker Error\n*${errorCode}*\nContext: ${context}\nMessage: ${message}\nTime: ${timestamp}`
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
```

### Step 2 — Import the error reporter in automation/index.js

At the top of `automation/index.js`, add:

```js
const { reportError } = require('./error_reporter.cjs');
```

### Step 3 — Add error reporting to critical failure points

In `automation/index.js`, find the IMAP connection error handler and add reporting.

Find code similar to:
```js
} catch (err) {
    console.error(`Error checking emails for company`, err.message);
}
```

Change to:
```js
} catch (err) {
    console.error(`Error checking emails for company`, err.message);
    await reportError('IMAP_ERROR', companyData?.imapUser || companyId, err).catch(() => {});
}
```

Also find the Firebase write error and add:
```js
await reportError('FIREBASE_WRITE_ERROR', invoiceId || 'unknown', err).catch(() => {});
```

### Step 4 — Verify syntax

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/index.js && echo "✅ Syntax OK" || echo "❌ Syntax Error"
node --check automation/error_reporter.cjs && echo "✅ Syntax OK" || echo "❌ Syntax Error"
```

### Step 5 — Commit

```bash
cd /Users/einarluha/invoice-tracker
git add automation/error_reporter.cjs automation/index.js
git commit -m "feat: add error reporting system with file logging and optional webhook alerts"
```

## Optional: Configure Webhook Alerts

To get notified of errors in Slack/Discord, set `ALERT_WEBHOOK_URL` in
`automation/.env`:

```
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

The invoice-bot will automatically send error notifications to that URL.
