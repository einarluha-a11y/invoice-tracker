---
name: Fix reconcilePayment — Add companyId Filter
description: Critical performance fix. reconcilePayment() loads ALL invoices from Firestore on every bank statement reconciliation. Add companyId filter so it only loads invoices for the relevant company.
priority: HIGH
triggers:
  - manual
---

// turbo-all

# TASK: Fix reconcilePayment() — Add companyId Filter

## Problem

In `automation/index.js`, the `reconcilePayment()` function currently loads
**ALL invoices** from Firestore every time a bank statement is processed:

```js
// Line ~514 — CURRENT (BAD — full collection scan):
const snapshot = await invoicesRef.get();
```

This is a critical performance issue. As the database grows, this will get
slower and slower, and could cause timeouts or high Firestore read costs.

The function already receives `reference` and `description` parameters but
does NOT have a `companyId` parameter. We need to add one.

## Fix

### Step 1 — Add companyId parameter to reconcilePayment() signature

Find the function signature in `automation/index.js`:

```js
async function reconcilePayment(reference, description, paidAmount, totalBankDrain = null, bankFee = null, paymentDateStr = null, foreignAmount = null, foreignCurrency = null) {
```

Change it to:

```js
async function reconcilePayment(reference, description, paidAmount, totalBankDrain = null, bankFee = null, paymentDateStr = null, foreignAmount = null, foreignCurrency = null, companyId = null) {
```

### Step 2 — Replace the full collection scan with a filtered query

Find this code block (around line 513-520):

```js
        // Fetch all invoices to intelligently split Unpaid vs Already Paid
        const snapshot = await invoicesRef.get();
        const pendingDocs = [];
        const paidDocs = [];
        snapshot.forEach(doc => {
```

Replace with:

```js
        // Fetch only invoices for this company (performance: avoid full collection scan)
        const snapshot = companyId
            ? await invoicesRef.where('companyId', '==', companyId).get()
            : await invoicesRef.get();  // fallback: load all if no companyId
        const pendingDocs = [];
        const paidDocs = [];
        snapshot.forEach(doc => {
```

### Step 3 — Pass companyId when calling reconcilePayment()

Search for all calls to `reconcilePayment(` in `automation/index.js`.

There should be calls inside the bank statement processing code. Add `companyId` as the last argument.

For example, find:
```js
await reconcilePayment(reference, description, invoiceTargetAmount, totalBankDrain, bankFee, dateStr, foreignAmount, foreignCurrency);
```

Change to:
```js
await reconcilePayment(reference, description, invoiceTargetAmount, totalBankDrain, bankFee, dateStr, foreignAmount, foreignCurrency, companyId);
```

Also find any other calls to reconcilePayment and add companyId where it's available in scope.

### Step 4 — Verify the changes compile correctly

Run in terminal:
```bash
cd /Users/einarluha/invoice-tracker
node --check automation/index.js && echo "✅ Syntax OK" || echo "❌ Syntax Error"
```

### Step 5 — Commit the fix

```bash
cd /Users/einarluha/invoice-tracker
git add automation/index.js
git commit -m "perf: add companyId filter to reconcilePayment() to avoid full collection scan"
```
