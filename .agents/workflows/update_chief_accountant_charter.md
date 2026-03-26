---
name: Update Chief Accountant Charter — Add Rules 23–28
description: Append 6 new rules to _agents/workflows/chief_accountant.md based on systemic failures and fixes discovered in the March 2026 code audit session.
priority: HIGH
triggers:
  - manual
---

// turbo-all

# TASK: Append New Rules to the Chief Accountant Charter

## Instructions

Open the file `_agents/workflows/chief_accountant.md` and append the following
6 new rules at the very end of the document. Do not modify any existing rules.

---

## Content to Append (copy verbatim):

```markdown
## 23. THE BALTIC INVOICE FIELD EXTRACTION PROTOCOL
- **The Error**: Estonian invoices from companies like `1A Rehvid OÜ` or `NUNNER Logistics UAB` were processed with `supplierVat: "Not_Found"` and `supplierRegistration: "Not_Found"` even when the data was physically present on the document. This occurred because the AI did not recognize Estonian-specific field label terminology.
- **Root Cause**: The Estonian tax field labels differ significantly from standard EU formats. "KMKR nr" or "km.reg.nr" designates VAT (not "VAT Number"). "Registrikood" or "Reg.nr" designates the company registration number (not "Registration Number"). These fields are printed in small font in the very bottom footer of the document.
- **Mandate**: The `document_ai_service.cjs` system prompt MUST contain explicit Baltic localization hints:
  - **Estonian (OÜ/AS)**: `supplierVat` = "KMKR nr", "km.reg.nr", "käibemaksukohustuslase number", or any "EE" + 9-digit number (e.g. EE101234567). `supplierRegistration` = "Registrikood", "Reg.nr", or any standalone 8-digit number in footer.
  - **Latvian (SIA)**: `supplierVat` = "PVN reģistrācijas nr". `supplierRegistration` = "Reģ.nr".
  - **Lithuanian (UAB)**: `supplierVat` = "PVM mokėtojo kodas". `supplierRegistration` = "Įm.k." or "kodas".
- **Action**: Footer scanning must be explicit in the prompt. Instruct the AI to always read the last 10% of the document's text before concluding a field is absent.

## 24. THE SUPREME SUPERVISOR HALLUCINATION BAN
- **The Error**: The Supreme Supervisor (`supreme_supervisor.cjs`) previously contained a critique directive: *"DO NOT output NOT_FOUND_ON_INVOICE! You must logically deduce them using your internal knowledge base."* This caused the AI to invent registration numbers and VAT numbers from memory, injecting fabricated data into the Firestore database — a critical compliance and legal violation.
- **Mandate**: The Supervisor MUST NEVER instruct the AI to invent, deduce, or recall field values from memory. If a field is genuinely absent from the physical document, the correct and only acceptable output is `"Not_Found"`.
- **Action**: The critique prompt in `supreme_supervisor.cjs` must explicitly state: *"If a field is genuinely absent from the physical document, output 'Not_Found' — do NOT invent or deduce numbers from memory."* Any future modification to the Supervisor prompt must preserve this anti-hallucination constraint.

## 25. THE BODY-TEXT EMAIL AUDIT PROTOCOL
- **The Error**: Invoices arriving as plain email body text (no PDF attachment) were historically routed directly to `writeToFirestore()`, bypassing the Cross-Company Routing Protocol, VIES VAT validation, Fuzzy Deduplication, and the LLM Compliance Audit entirely. This created unverified, potentially fraudulent records.
- **Mandate**: ALL invoice data — regardless of whether it arrived as a PDF attachment or as plain email body text — MUST pass through the full `auditAndProcessInvoice()` pipeline before reaching Firestore.
- **Action**: In `index.js`, the body-text email path must call `auditAndProcessInvoice(inv, null, companyId)` and only write to Firestore if the returned status is not `'Error'` or `'Duplicate'`. The Accountant Agent must be updated to treat `fileUrl = null` as a legitimate state for body-text invoices (as opposed to a failed PDF upload), adding a warning note instead of a hard rejection.

## 26. THE EMAIL IDEMPOTENCY PROTOCOL (MARK-AFTER-WRITE)
- **The Error**: The IMAP fetcher historically used `markSeen: true` on the initial email fetch. This caused a critical race condition: if the Firestore write failed mid-pipeline (e.g., Firebase timeout, extraction error), the email was permanently marked as `\Seen` and never reprocessed — the invoice was silently lost forever.
- **Mandate**: An email must NEVER be marked as processed until after the Firestore write has been confirmed successful.
- **Action**: The IMAP fetch MUST use `markSeen: false`. The `\\Seen` IMAP flag must only be applied via `connection.imap.addFlags(id, ['\\Seen'], () => {})` immediately after `writeToFirestore()` confirms success. This guarantees that any crash during processing leaves the email available for retry on the next polling cycle.

## 27. THE PM2 WATCH ISOLATION PROTOCOL (RESTART LOOP PREVENTION)
- **The Error**: Any log file, flag file, or output file written inside the `automation/` directory triggers PM2's watch mode, causing an immediate process restart. If the restarted process writes another file to `automation/`, an infinite restart loop occurs — no task ever completes.
- **Mandate**: Files generated at RUNTIME (logs, flags, debug output) must NEVER be written inside the `automation/` directory.
- **Action**:
  1. All runtime log files must be written to the project root (`__dirname + '/..'`) or to a dedicated `logs/` directory outside `automation/`.
  2. Flag files (`.flag`) that trigger task execution must be deleted by the flag runner BEFORE the task starts — not after — to prevent PM2 from detecting the flag and restarting again mid-execution.
  3. When writing recovery or maintenance scripts that are called from within `index.js`, they must be spawned as isolated child processes (`spawn(process.execPath, [scriptPath])`) rather than required as Node modules, to prevent gRPC connection sharing which causes Firebase queries to hang indefinitely.

## 28. THE FIREBASE gRPC ISOLATION PROTOCOL
- **The Error**: When a recovery or maintenance script is `require()`-d from within `index.js` (already running as a PM2 process), the Firebase Admin SDK attempts to reuse the parent process's gRPC connection. After a PM2 restart, this connection is in an undefined state, causing all Firestore queries in the child module to hang indefinitely with no timeout or error — the process freezes silently.
- **Mandate**: Any script that performs its own Firestore operations and is invoked programmatically from `index.js` MUST use one of two isolation strategies:
  1. **Named Firebase App**: Initialize with `admin.initializeApp({...}, 'unique-app-name')` instead of the default app, so a fresh gRPC connection is established independently.
  2. **Child Process Spawn** (preferred): Use `child_process.spawn(process.execPath, [scriptPath])` to run the script in a completely isolated Node.js environment with its own memory, gRPC channels, and Firebase state. Always use `process.execPath` instead of the string `'node'` to guarantee the correct binary is found regardless of PM2's PATH environment.
```

---

## After Appending

Verify the file was updated correctly:
```bash
tail -50 /Users/einarluha/invoice-tracker/_agents/workflows/chief_accountant.md
```

Then commit:
```bash
cd /Users/einarluha/invoice-tracker
git add _agents/workflows/chief_accountant.md
git commit -m "docs: add rules 23-28 to Chief Accountant Charter (March 2026 audit session)"
```
