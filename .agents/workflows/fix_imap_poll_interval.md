---
name: Fix IMAP Polling — Increase Interval from 60s to 5 Minutes
description: The backend polls ALL email inboxes every 60 seconds. This is too aggressive, causes unnecessary API load, and risks hitting IMAP rate limits. Change to every 5 minutes (300 seconds).
priority: MEDIUM
triggers:
  - manual
---

// turbo-all

# TASK: Fix IMAP Polling Interval (60s → 5 minutes)

## Problem

In `automation/index.js`, the email polling runs every **60 seconds**:

```js
// Near the bottom of index.js — CURRENT (too aggressive):
setInterval(pollAllCompanyInboxes, 60000);
```

60 seconds is excessive for invoice emails, which arrive at most a few times per day.
This causes:
- Unnecessary load on IMAP servers (risk of rate limiting / IP blocks)
- Higher Firebase read costs (each poll checks for duplicates)
- Battery/CPU drain on the host machine

## Fix

### Step 1 — Change the polling interval

Find in `automation/index.js` near the bottom:

```js
setInterval(pollAllCompanyInboxes, 60000);
```

Change to:

```js
setInterval(pollAllCompanyInboxes, 5 * 60 * 1000);  // Every 5 minutes
```

Also update the log message just above it (if present) from "every 60 seconds" to "every 5 minutes":

Find:
```js
console.log('Automated Invoice Processor Started. Checking every 60 seconds...');
```

Change to:
```js
console.log('Automated Invoice Processor Started. Checking every 5 minutes...');
```

### Step 2 — Verify syntax

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/index.js && echo "✅ Syntax OK" || echo "❌ Syntax Error"
```

### Step 3 — Commit

```bash
cd /Users/einarluha/invoice-tracker
git add automation/index.js
git commit -m "perf: increase IMAP polling interval from 60s to 5 minutes to reduce server load"
```

### Step 4 — Restart the backend to apply the change

```bash
pm2 restart invoice-bot
pm2 logs invoice-bot --lines 5
```

Verify the log shows "Checking every 5 minutes".
