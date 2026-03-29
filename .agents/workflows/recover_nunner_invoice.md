---
name: Recover NUNNER Logistics Invoice
description: Fix broken NUNNER Logistics UAB invoice record (amount=0, missing file/VAT/RegNo). Scans email inbox, re-extracts with AI, saves correct record to Firestore.
triggers:
  - manual
---

// turbo-all

# TASK: Recover NUNNER Logistics UAB Invoice

## Background
The invoice from NUNNER Logistics UAB (ID: 42260200134) was saved to the database
with amount=0, no attached PDF, no VAT number, and no registration number.
This task re-processes the invoice from scratch using the correct pipeline.

## Steps

### Step 1 — Run the recovery script in the terminal

```bash
cd /Users/einarluha/invoice-tracker
node automation/nunner_recover.cjs
```

Watch the output carefully. The script will:
1. Delete the bad zero-amount record from Firestore
2. Scan all connected email inboxes for NUNNER Logistics PDFs
3. Re-extract invoice data using Claude AI
4. Upload the PDF to Firebase Storage
5. Save the correct record to Firestore

### Step 2 — Check the result log

```bash
cat /Users/einarluha/invoice-tracker/recovery_debug.log
```

Look for:
- `✅ DONE. Recovered 1 Nunner invoice(s).` — SUCCESS
- `⚠️  No Nunner invoices recovered` — see troubleshooting below

### Step 3 — Verify on dashboard

Open the Invoice-Tracker app in the browser and check that NUNNER Logistics UAB now
shows the correct amount, attached PDF, VAT number, and registration number.

## Troubleshooting

If the recovery script says "No Nunner invoices recovered":

**Option A — IMAP auth failed for the account holding the invoice:**
Check the log for lines like `❌ IMAP connection FAILED`. If one account fails auth,
the invoice may be in that account. Fix: update the IMAP password for that company
in the Firebase console under `companies/{companyId}.imapPassword`.

**Option B — Invoice email was deleted from inbox:**
The PDF may no longer be in the inbox. In this case, manually forward the original
invoice email back to the monitored inbox, wait 60 seconds for auto-processing,
and verify the dashboard.

**Option C — AI extraction keeps returning amount=0:**
The PDF may be a scanned image requiring OCR improvements. Check the log for
`Extracted: amount=0` and note what other fields were extracted.
The record will be saved with status NEEDS_REVIEW — manually correct the amount
in the Invoice-Tracker dashboard.
