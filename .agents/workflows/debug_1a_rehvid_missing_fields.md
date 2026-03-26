---
name: Debug — 1A Rehvid OÜ Missing VAT, Reg No, and File
description: Invoice from 1A Rehvid OÜ was saved to the database without VAT number, registration number, and file attachment. Diagnose which agent failed and fix it.
priority: URGENT
triggers:
  - manual
---

// turbo-all

# TASK: Debug 1A Rehvid OÜ — Missing VAT, Reg No, and File

## Suspected Failure Points (pre-analysis by Claude/Cowork)

There are **three possible culprits**. The investigation below will identify
which one (or which combination) actually failed.

### Suspicion A — Document AI failed to extract VAT and Reg No
The AI prompt already has Estonian hints ("KMKR" = VAT, "Registrikood" = Reg No)
but it may have returned "Not_Found" if the PDF quality was poor or the footer
was not scanned properly.

### Suspicion B — Firebase Storage upload silently failed
If all 3 upload retries failed, the code calls `auditAndProcessInvoice(inv, null, companyId)`.
The Accountant Agent then returns `status: 'Error'` when it sees `fileUrl = null`.
HOWEVER: currently `saveParsedData` sets `success = true` even for Error status,
so the email gets marked as processed but the invoice is silently discarded.

### Suspicion C — Accountant Agent's SPAM filter rejected the invoice
The "Cross-Company Routing Protocol" (Rule 10) in `accountant_agent.cjs` checks
whether the `receiverName` on the invoice matches a registered company. If the
AI extracted an unrecognized receiver name, the invoice is rejected as SPAM.

---

## Step 1 — Check PM2 Logs

Run in terminal:
```bash
pm2 logs invoice-bot --lines 200 | grep -i "rehvid\|1A\|Estonian\|Error\|CRITICAL\|Rejection\|Storage\|Upload\|SPAM\|Receiver"
```

Look for:
- `[Storage] Uploading` — did the upload attempt happen?
- `[Storage Error]` — did the upload fail?
- `[Accountant Agent] 🛑 CRITICAL REJECTION` — was the invoice rejected?
- `[Vision Auditor]` — was it classified correctly as INVOICE?
- `[Supervisor]` — how many extraction attempts?

---

## Step 2 — Check What Is Currently in Firestore

Run in terminal:
```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const admin = require('./automation/node_modules/firebase-admin');
const sa = require('./automation/google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
admin.firestore().collection('invoices').get().then(snap => {
  snap.forEach(d => {
    const data = d.data();
    if ((data.vendorName || '').toLowerCase().includes('rehvid')) {
      console.log('--- FOUND ---');
      console.log(JSON.stringify(data, null, 2));
    }
  });
  process.exit(0);
});
"
```

This shows exactly what was saved. Look at:
- `fileUrl`: is it null or a valid URL?
- `supplierVat`: is it "Not_Found"?
- `supplierRegistration`: is it "Not_Found"?
- `validationWarnings`: what errors were logged?
- `status`: "Needs Action", "Error", "ANOMALY_DETECTED"?

---

## Step 3 — Diagnose Based on Findings

### If fileUrl is null AND record IS in Firestore:
→ There is a BUG: the Accountant Agent returns 'Error' for missing fileUrl but
  somehow the record still got written. Check the flow from the body-text email
  path (`automation/index.js` around line 1092-1098). The fix: add a fileUrl
  check BEFORE calling auditAndProcessInvoice for body-text emails.

### If fileUrl is null AND record is NOT in Firestore:
→ Suspicion B confirmed: upload failed, invoice correctly rejected, but SILENTLY.
  Fix: add a meaningful log warning when upload fails and invoice is discarded.
  Also check Firebase Storage rules to ensure write access.

### If supplierVat = "Not_Found" AND supplierRegistration = "Not_Found":
→ Suspicion A confirmed: AI couldn't find Estonian fields.
  Fix: improve the AI prompt in `automation/document_ai_service.cjs` (see Step 4).

### If record is not in Firestore at all:
→ Check for SPAM filter rejection (Suspicion C).
  Fix: check what receiverName the AI extracted for this invoice.

---

## Step 4 — Fix the AI Prompt for Estonian Invoices

If Suspicion A is confirmed, open `automation/document_ai_service.cjs` and find
the LOCALIZATION HINTS section:

```
3. LANGUAGE & LOCALIZATION HINTS: Be extremely careful with Baltic invoices.
"KMKR" or "käibemaksukohustuslase nr" = VAT Reg No (supplierVat),
"Registrikood" = Supplier Reg No (supplierRegistration).
```

Improve it to be more specific about Estonian invoice footer formats:

```
3. LANGUAGE & LOCALIZATION HINTS: Baltic invoices are critical. For ESTONIAN (OÜ/AS companies):
- supplierVat: look for "KMKR nr", "km.reg.nr", "käibemaksukohustuslase number", or "EE" prefix + 9 digits (e.g. EE101234567)
- supplierRegistration: look for "Reg.nr", "registrikood", "reg.kood", or an 8-digit number in the footer
- These fields are ALWAYS in the tiny footer at the very bottom of the page — scan it carefully
- "Käibemaks" = VAT amount, "Kokku käibemaksuga" = Total with VAT, "Summa" or "Kokku" = Total
- For LATVIAN (SIA companies): "PVN" = VAT, "Reģ.nr" = Reg No
- For LITHUANIAN (UAB companies): "PVM" = VAT, "Įm.k." or "kodas" = Reg No
- For Czech/Slovak: "IČO" = Reg No, "DIČ" = VAT No
```

---

## Step 5 — Fix the File Integrity Check in Body-Text Email Path

In `automation/index.js` around line 1092, find the body-text email processing:

```js
for (let inv of parsedData) {
    inv.companyId = companyId;
    try {
        const auditedData = await auditAndProcessInvoice(inv, inv.fileUrl || null, companyId);
        if (auditedData.status !== 'Duplicate' && auditedData.status !== 'Error') {
            await writeToFirestore([auditedData]);
        }
    }
```

Add a note: body-text invoices legitimately have no file attachment. The Accountant
Agent currently rejects them with `status: 'Error'` because `fileUrl = null`.
Fix by passing a placeholder or adjusting the check to allow body-text invoices:

Change:
```js
const auditedData = await auditAndProcessInvoice(inv, inv.fileUrl || null, companyId);
```
To:
```js
const auditedData = await auditAndProcessInvoice(inv, inv.fileUrl || 'BODY_TEXT_NO_ATTACHMENT', companyId);
```

And in `automation/accountant_agent.cjs`, change the file check at the top:
```js
if (!fileUrl) {
```
To:
```js
if (!fileUrl || fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
    if (fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
        // Body-text invoice — no file is expected, continue with null fileUrl
        fileUrl = null;
        warnings.push("NOTE: Invoice extracted from email body text — no PDF attachment.");
    } else {
        console.error(`[Accountant Agent] 🛑 CRITICAL REJECTION: PDF File URL is missing.`);
        warnings.push("CRITICAL: Original PDF document was lost or failed to upload.");
        return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
    }
}
```

---

## Step 6 — Re-process the 1A Rehvid OÜ Invoice

After making fixes, forward the original 1A Rehvid OÜ email back to the monitored
inbox (or wait for the next invoice from them). The improved AI prompt should now
correctly extract VAT and Reg No.

Alternatively, delete the bad record from Firestore and let it re-process:
```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const admin = require('./automation/node_modules/firebase-admin');
const sa = require('./automation/google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
admin.firestore().collection('invoices').get().then(async snap => {
  for (const d of snap.docs) {
    const data = d.data();
    if ((data.vendorName || '').toLowerCase().includes('rehvid')) {
      await d.ref.delete();
      console.log('Deleted:', d.id, data.vendorName);
    }
  }
  process.exit(0);
});
"
```

---

## Step 7 — Verify Syntax and Commit

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/index.js && echo "✅ index.js OK"
node --check automation/accountant_agent.cjs && echo "✅ accountant_agent.cjs OK"
node --check automation/document_ai_service.cjs && echo "✅ document_ai_service.cjs OK"
git add automation/document_ai_service.cjs automation/accountant_agent.cjs automation/index.js
git commit -m "fix: improve Estonian invoice field extraction and handle body-text invoice file check"
```
