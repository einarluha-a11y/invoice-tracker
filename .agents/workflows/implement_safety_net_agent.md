---
name: Implement Safety Net Agent — No Invoice Must Ever Be Lost
description: 3 invoices arrived in one email (2x Terma + 1x Dmytro Suprun). Only 2 were recorded, 1 is completely lost. No attached files on any of them. Currently there is no agent guaranteeing unconditional recording. Fix the root cause and implement a Safety Net so every invoice is always saved — even if with DRAFT status.
priority: CRITICAL
triggers:
  - manual
---

// turbo-all

# TASK: Safety Net Agent — Zero Invoice Loss Guarantee

## The Problem

Currently, an invoice can be permanently and silently lost at 4 different points:
1. **Vision Auditor** rejects it as "not an invoice"
2. **Accountant Agent** rejects it: missing fileUrl, zero amount, or SPAM filter (Rule 10)
3. **writeToFirestore** rejects it: no fileUrl check
4. **Deduplication** marks it as Duplicate and skips writing

None of these stages save a fallback record. The invoice disappears with no trace in the database.

**In this specific case**: 3 invoices in 1 email → only 2 saved → 1 lost, 0 files attached.

---

## Step 1 — Diagnose the Lost Invoice

Run in terminal:
```bash
pm2 logs invoice-bot --lines 300 | grep -i "terma\|suprun\|storage\|upload\|reject\|error\|spam\|duplicate\|vision\|attachment"
```

Look specifically for:
- How many attachments were detected in the email
- Did the Vision Auditor reject one?
- Did the Storage upload fail for all 3?
- Did the SPAM filter (Rule 10 receiver name check) reject one Terma invoice?
- Was one Terma invoice flagged as a Duplicate of the other?

---

## Step 2 — Diagnose the Missing Files

The paperclip icon is missing on both saved invoices. This means `fileUrl` is null in Firestore despite the invoices being saved.

Check the Accountant Agent logic in `automation/accountant_agent.cjs` line ~96:
```js
if (!fileUrl) {
    return { ...docAiPayload, fileUrl: null, status: 'Error', validationWarnings: warnings };
}
```

If fileUrl is null, the Accountant Agent returns status 'Error'. But the invoices ARE saved with no file... This means there is a code path that bypasses this check. Find it:

Search `automation/index.js` for any place that calls `writeToFirestore` directly without going through `auditAndProcessInvoice`, or any place where the fileUrl check is skipped.

Also check Firebase Storage permissions:
```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const admin = require('./automation/node_modules/firebase-admin');
const sa = require('./automation/google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: 'invoice-tracker-xyz.firebasestorage.app' });
const bucket = admin.storage().bucket();
bucket.file('test-write-' + Date.now() + '.txt').save('test', (err) => {
  if (err) console.error('Storage WRITE FAILED:', err.message);
  else console.log('Storage write OK');
  process.exit(0);
});
"
```

---

## Step 3 — Implement the Safety Net Agent

### 3a — Create `automation/safety_net.cjs`

Create a new file:

```js
/**
 * SAFETY NET AGENT
 * Rule 31: Zero Invoice Loss Guarantee
 *
 * This module is called whenever any stage of the pipeline rejects or fails
 * to process an invoice. Instead of silently discarding it, the Safety Net
 * saves a DRAFT record to Firestore so no invoice is ever permanently lost.
 *
 * DRAFT records appear on the dashboard with a clear "NEEDS REVIEW" status
 * and a warning explaining why the normal pipeline rejected them.
 */

const admin = require('firebase-admin');

async function safetyNetSave(rawData, reason, companyId, fileUrl = null) {
    try {
        const db = admin.firestore();

        // Build minimal record from whatever data we have
        const draftRecord = {
            vendorName: rawData.vendorName || rawData.vendor || 'UNKNOWN VENDOR',
            invoiceId: rawData.invoiceId || `DRAFT-${Date.now()}`,
            amount: rawData.amount || null,
            currency: rawData.currency || 'EUR',
            dateCreated: rawData.dateCreated || rawData.issueDate || new Date().toISOString().split('T')[0],
            dueDate: rawData.dueDate || null,
            supplierVat: rawData.supplierVat || 'Not_Found',
            supplierRegistration: rawData.supplierRegistration || 'Not_Found',
            fileUrl: fileUrl || rawData.fileUrl || null,
            companyId: companyId || rawData.companyId || null,
            status: 'NEEDS_REVIEW',
            validationWarnings: [
                `SAFETY NET: Invoice saved as DRAFT because normal pipeline rejected it.`,
                `Rejection reason: ${reason}`,
                ...(rawData.validationWarnings || [])
            ],
            safetyNetCapturedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Check for duplicate DRAFT (same invoiceId + vendor in last 24h)
        if (draftRecord.invoiceId && !draftRecord.invoiceId.startsWith('DRAFT-')) {
            const existing = await db.collection('invoices')
                .where('invoiceId', '==', draftRecord.invoiceId)
                .where('status', '==', 'NEEDS_REVIEW')
                .limit(1)
                .get();
            if (!existing.empty) {
                console.log(`[Safety Net] Skipping duplicate DRAFT for invoiceId=${draftRecord.invoiceId}`);
                return null;
            }
        }

        const ref = await db.collection('invoices').add(draftRecord);
        console.log(`[Safety Net] ✅ Saved DRAFT record: ${ref.id} (vendor: ${draftRecord.vendorName}, reason: ${reason})`);
        return ref.id;
    } catch (err) {
        console.error(`[Safety Net] ❌ CRITICAL: Even Safety Net failed to save:`, err.message);
        return null;
    }
}

module.exports = { safetyNetSave };
```

### 3b — Integrate Safety Net into `automation/index.js`

At the top of `index.js`, add:
```js
const { safetyNetSave } = require('./safety_net.cjs');
```

Find the main attachment processing loop in `checkEmailForInvoices`. Wrap the entire try/catch for each attachment with a Safety Net call on failure:

Find this pattern (around the Storage upload section):
```js
} catch (err) {
    console.error(`[Error] Failed to process attachment ${filename}:`, err);
}
```

Change to:
```js
} catch (err) {
    console.error(`[Error] Failed to process attachment ${filename}:`, err);
    // Safety Net: save a DRAFT so the invoice is never silently lost
    await safetyNetSave(
        { vendorName: filename, invoiceId: `ATTACHMENT-${filename}` },
        `Pipeline exception: ${err.message}`,
        companyId,
        null
    ).catch(() => {});
}
```

Also find the Accountant Agent call in `saveParsedData`:
```js
if (auditedData.status === 'Duplicate' || auditedData.status === 'Error') {
    console.error(`[Accountant Agent] 🛑 Invoice rejected: ${auditedData.status}`);
    success = true;
}
```

Change to:
```js
if (auditedData.status === 'Duplicate') {
    console.log(`[Accountant Agent] ℹ️ Duplicate detected — skipping.`);
    success = true;
} else if (auditedData.status === 'Error') {
    console.error(`[Accountant Agent] 🛑 Invoice rejected with Error status.`);
    // Safety Net: save as DRAFT instead of discarding
    const warnings = auditedData.validationWarnings || [];
    await safetyNetSave(
        auditedData,
        warnings.join('; ') || 'Accountant Agent returned Error status',
        companyId,
        fileUrl
    ).catch(() => {});
    success = true;
}
```

### 3c — Safety Net for Vision Auditor rejection

Find where Vision Auditor rejects a document:
```js
if (visionClass !== 'INVOICE') {
    console.log(`[Vision Auditor] 🚨 Skipping attachment ${attachment.filename}. Classified as: ${visionClass}`);
    continue;
}
```

Add a Safety Net call just before `continue` for borderline cases where classification might be wrong. Only trigger if the file looks like it could be an invoice (has .pdf extension or common invoice filename patterns):

```js
if (visionClass !== 'INVOICE') {
    console.log(`[Vision Auditor] 🚨 Skipping attachment ${attachment.filename}. Classified as: ${visionClass}`);
    // Safety Net: if filename suggests invoice but Vision rejected it, save as DRAFT for review
    const looksLikeInvoice = /inv|arve|faktur|rechnung|factura|facture/i.test(filename);
    if (looksLikeInvoice) {
        await safetyNetSave(
            { vendorName: 'UNKNOWN (Vision rejected)', invoiceId: `VISION-${filename}` },
            `Vision Auditor classified as ${visionClass} but filename suggests invoice`,
            companyId,
            null
        ).catch(() => {});
    }
    continue;
}
```

---

## Step 4 — Add Rule 31 to Chief Accountant Charter

Open `_agents/workflows/chief_accountant.md` and append:

```markdown
## 31. THE ZERO INVOICE LOSS GUARANTEE (SAFETY NET PROTOCOL)
- **The Error**: The invoice pipeline contained 4 silent discard points where an invoice could be permanently and irrecoverably lost: (1) Vision Auditor rejection, (2) Accountant Agent Error status, (3) writeToFirestore file integrity check, and (4) unhandled pipeline exceptions. An invoice rejected at any of these points left no trace in the database — as if it never existed.
- **Real Example**: An email with 3 invoices (2x Terma Sp. z o.o. + 1x Dmytro Suprun) was processed. Only 2 invoices were saved. The third was silently discarded with no error visible in the dashboard.
- **Mandate**: NO invoice must ever be permanently lost. Every rejection must produce a fallback DRAFT record in Firestore with:
  - `status: "NEEDS_REVIEW"`
  - The rejection reason in `validationWarnings`
  - Whatever partial data was successfully extracted
  - A `safetyNetCapturedAt` timestamp
- **Action**: The `automation/safety_net.cjs` module provides `safetyNetSave(rawData, reason, companyId, fileUrl)`. It MUST be called at every pipeline discard point. The DRAFT record appears on the dashboard with a yellow warning triangle, allowing the user to review and correct it manually.
- **Exception**: Confirmed exact duplicates (same invoiceId + vendor + amount) do NOT trigger the Safety Net — they are intentionally skipped.
```

---

## Step 5 — Verify and Commit

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/safety_net.cjs && echo "✅ safety_net OK"
node --check automation/index.js && echo "✅ index.js OK"
git add automation/safety_net.cjs automation/index.js _agents/workflows/chief_accountant.md
git commit -m "feat: implement Safety Net Agent — zero invoice loss guarantee (Rule 31)"
pm2 restart invoice-bot
```
