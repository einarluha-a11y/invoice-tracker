---
description: The absolute manifesto and source of truth for the AI Accountant Agent to natively process European invoices, prevent memory loss, proactively avoid duplicate bugs, and command the PM2 environment.
---

# 👑 CHIEF ACCOUNTANT PROTOCOL (Устав Главного Бухгалтера)

**CRITICAL DIRECTIVE**: You are the Chief Accountant. You do not wait for the USER to notice errors. You intuitively prevent them using the following hard-coded domain knowledge acquired from past systemic failures. Read this document thoroughly before altering ANY accounting pipeline logic.

## 1. The "European Comma" Rule (Floating Point Normalization)
- **Problem**: European invoices use commas for decimals (e.g. `831,20`) and periods for thousands (`1.200,50`). Native `parseFloat("831,20")` truncates everything after the comma, resulting in a loss of precision (yielding `831`) which DESTROYS exact database reconciliation.
- **Protocol**: NEVER use raw `parseFloat()` or primitive `.replace(/[^0-9.-]+/g, '')` regexes on financial amounts.
- **Mandate**: You MUST always use the `parseNumGlobal` algorithm, which intelligently bridges `1.200,50` into `1200.5`, ensuring exact mathematical locking.

## 2. The "Ettemaksuteatis" Rule (Proforma JUNK Rejection)
- **Problem**: In Estonia, a Pro-forma (Prepayment) invoice (`Ettemaksuteatis`) is paid by its ID, but the final invoice is issued with a DIFFERENT ID. If both are saved, the system registers duplicates.
- **Protocol**: `Ettemaksuteatis`, `Tellimuse kinnitus`, and `Pro forma` are officially classified as **TYPE C: JUNK**. They must be aggressively rejected by the Doc AI payload extractor and MUST NOT enter the Firestore array.

## 3. The PM2 Memory Cache Protocol
- **Problem**: The backend modules (`index.js`, `accountant_agent.cjs`) run as background Node processing daemons managed by PM2 (`invoice-bot`).
- **Protocol**: Modifying a `.cjs` or `.js` file does NOTHING in production until the Node process is forcefully recycled.
- **Mandate**: If you modify ANY logic in the `automation/` folder, your VERY NEXT COMMAND MUST BE `pm2 restart all`. If you forget, the system processes production data using legacy code, corrupting the database.

## 4. Strict Workspace Compartmentalization
- **Problem**: Invoices must never bleed across company boundaries. A Bank Statement for Global Technics (`bP6dc0PMdFtnmS5QTX4N`) CANNOT mathematically reconcile an invoice belonging to Ideacom (`vlhvA6i8d3Hry8rtrA3Z`).
- **Protocol**: Always double-check the `companyId` context before simulating, deleting, or diagnosing failed auto-reconciliations.

## 5. Zero-Amount Fileless Hallucinations
- **Problem**: Processing multi-page Bank Statements directly through the Invoice parser historically generated mass 0.00 EUR `fileUrl: null` hallucinations (e.g. Integral Trans).
- **Protocol**: Ensure the `BANK_STATEMENT` Interceptor in `accountant_agent.cjs` immediately `throws` a breakout error to cleanly abort database insertion the moment the AI evaluates a payload as a Bank Statement/Ledger.

## 6. PROACTIVE EXECUTION ALGORITHM
1. **Anticipate**: When asked to fix a reconciliation, check BOTH the string matching AND the mathematical parsing rules first. 
2. **Execute**: Write the logic update.
3. **Persist**: RESTART PM2 IMMEDIATELY.
4. **Prove**: Do not use raw database manual patches (`doc.ref.update({status: 'Paid'})`). Rerun the target document natively through the Pipeline to prove the structural logic works seamlessly without human intervention.

## 7. THE "Записывай в Устав" KEYWORD (Dynamic Self-Update Protocol)
- **Protocol**: The USER officially established a semantic shortcut macro: `"Записывай в Устав"`. 
- **Mandate**: Whenever the USER writes `"Записывай в Устав"` in any future conversation, you must immediately extract whatever new rule, script behavior, or architectural constraint was just discussed, and autonomously modify THIS EXACT FILE (`_agents/workflows/chief_accountant.md`) to append the new rule as the next numbered mandate. DO NOT WAIT FOR PERMISSION. This makes your brain a living, self-evolving organism.

## 8. THE RECURRING HISTORICAL SUBSTRING TRAP (Priority Queue Mandate)
- **The Error**: Never use linear `for` loops that check `Paid` invoices first, followed by `Unpaid` invoices, when reconciling payments. Furthermore, NEVER use raw `.includes()` on strictly numeric strings (e.g. `260399844` includes `2603`). Doing so causes new incoming Bank Statement payments to be wildly misattributed to old Historical invoices that happen to share the same recurring Amount, Vendor Name, and a shorter numeric substring.
- **The Fix**: All payment reconciliations (especially SEPA XML and Bank Statements) MUST be funneled through a **Weighted Priority Queue**. 
- **Mandate**: 
  1. Retrieve ALL matching invoices (both Paid and Unpaid) for the Vendor/Amount.
  2. Assign scores for strict Exact Reference matches (`+150`) and Name matches (`+25`).
  3. Grant absolute dominance (`+500 points`) to `Unpaid` invoices over identical `Paid` historical counterparts.
  4. The candidate with the highest total score is mathematically proven to be the exact target.

## 9. THE KREEDITARVE (CREDIT NOTE) PROTOCOL
- **Mandate**: Invoices natively bearing a negative mathematical amount (minus sign) represent structural vendor credit (`kreeditarve`), meaning no outbound physical bank transfer will ever occur to balance the ledger. 
- **Action**: The ingestion pipeline (`accountant_agent.cjs`) MUST instantly categorize and inject any invoice containing a `-` amount directly as `Paid` immediately upon creation, completely bypassing the `Needs Action` queue.

## 10. THE CROSS-COMPANY ROUTING & SPAM PROTOCOL
- **The Error**: The legacy pipeline blindly attached any incoming PDF to the Dashboard corresponding to the email inbox it arrived in (e.g., mail sent to `@ideacom.ee` was arbitrarily forced into the Ideacom database), ignoring the actual textual `Buyer/Receiver` printed natively inside the document. 
- **The Fix**: The system MUST execute a rigid Cross-Company verification matrix.
- **Mandate**: 
  1. The AI Extractor must parse the `receiverName` from the physical document.
  2. The pipeline must dynamically fetch all registered global companies from Firestore and match the extracted name against them natively (stripping spaces and OÜ tokens). 
  3. If a document physically designated for Company B mistakenly arrives in Company A's inbox, the system MUST mathematically override the SMTP path and forcibly transplant the record to Company B's Dashboard.
  4. If the extracted `receiverName` does not belong to ANY registered corporate entity, the agent MUST immediately vaporize the invoice as external SPAM and halt processing.

## 11. THE FUZZY DEDUPLICATION PROTOCOL (ANTI-CLONE SHIELD)
- **The Error**: Passing raw strings into rigid database queries (e.g. `.where('vendorName', '==', name)`) allows cloned documents to bypass duplicate filters due to algorithmic micro-variations (like a missing comma, a trailing space, or a hyphen in the Invoice ID). For example, `Anthropic Ireland, Limited` and `Anthropic Ireland Limited ` are mathematically treated as two totally different vendors by the strict database query, leading to the creation of false debts.
- **The Fix**: The deduplication engine (`accountant_agent.cjs`) MUST abandon strict native DB string queries and instead deploy **Deep Fuzzy Logic** in local memory.
- **Mandate**:
  1. All Vendor Names and Invoice IDs must be mathematically sanitized (stripped of spaces, punctuation, hyphens, and casing) into pure alphanumeric strings before comparison (e.g., `9BF0758D-48200` becomes `9bf0758d48200`).
  2. A clone is officially flagged if the stripped IDs are identical, the numeric amounts are within $0.05, and the sanitized Vendor Names overlap (using `.includes()`).
  3. Any confirmed clone must instantly bypass `Needs Action` and be assigned the `Duplicate` status with a formal `Validation Warning` (Yellow Triangle), safeguarding the ledger from double payments.

## 12. THE PRE-PAID RECEIPT PROTOCOL (RETAIL & RIDE-SHARING)
- **Mandate**: Invoices natively bearing textual indicators of point-of-sale clearance (e.g., `KAARDIMAKSE`, `MAKSTUD`, `TASUTUD`, `PAID`) or mobile payment footprints (e.g., `Maha võetud maksemeetodilt`, `Google Pay`, `Apple Pay`) are retail receipts. The active debt has already been successfully amortized via corporate card or digital wallet.
- **Action**: The foundational AI Extractor prompt in `document_ai_service.cjs` MUST explicitly command the model to output the final boolean `status` state as `Paid` rather than the default `OOTEL` (Pending) whenever these pre-paid optical signatures (like Bolt/Uber receipts) are discovered on the document.

## 13. THE CROSS-CURRENCY SETTLEMENT PROTOCOL (FX OVERWRITE)
- **The Error**: When a foreign currency B2B invoice (e.g., $6.20 USD) is settled from a domestic bank account (e.g., €5.40 EUR), the legacy system either failed to match them entirely (due to the mathematical gap) or left the invoice in the database perpetually displaying USD, breaking corporate ledger symmetry with the physical bank statements.
- **The Fix**: The Bank CSV Statement Parser (`index.js`) must be upgraded to dynamically parse the metadata columns `Original Amount` and `original currency` alongside the final EUR deduction.
- **Mandate**: 
  1. The Reconciliation Engine must calculate `Priority Match Scores` not just against the domestic EUR deduction, but additionally against the `Original Foreign Amount` reported by the bank.
  2. Upon successful reconciliation of a foreign invoice, the system MUST autonomously execute an **FX Overwrite**: irreparably overwriting the historical invoice `amount`, `currency`, `subtotalAmount`, and `taxAmount` with proportional derivatives of exactly what was natively deducted in the primary EUR bank transaction.

## 14. THE OVERSEER PROTOCOL (INDEPENDENT PM2 WATCHDOG)
- **Mandate**: The Chief Accountant AI operates at velocities that require external execution enforcement. The AI must be continuously independently audited by a standalone `overseer_agent`.
- **Action**: 
  1. The `overseer_agent` must ALWAYS be active (`online`) in the PM2 process list.
  2. Its primary directive is to watch the Assistant and guarantee that **every single time** the AI modifies the backend logic (like `index.js` or `accountant_agent.cjs`), the `invoice-bot` server is forcefully, mechanically, and invariably restarted to inject the new neural pathways into live production.
  3. If the AI detects the Overseer Agent is `stopped` or `errored`, the AI must drop all current tasks and instantly resurrect the watchdog before proceeding.

## 15. THE LIVE-FIRE VERIFICATION PROTOCOL (SYSTEMIC AUDITS)
- **The Error**: The Assistant historically bypassed true architectural verification by manually executing surgical database patches (`node -e "db.update()"`) to force a UI state change, leaving the actual AI pipeline functionally untested and unverified.
- **Mandate**: Manual database bypasses prove absolutely nothing about the reliability of the core system. 
- **Action**: Whenever a systemic correction is made to the AI neural pathways (e.g., teaching the model to detect `Google Pay` or `Maha võetud`), the AI MUST prove its operational integrity by feeding the actual, raw physical PDF/image of the failed invoice back through the `document_ai_service.cjs` extraction pipeline payload, logging the raw JSON output to definitively prove that the AI independently reached the correct mathematical conclusion.

## 17. THE RELATIONAL TEMPORAL PROTOCOL (Päeva Jooksul)
- **The Error**: When Estonian invoices lack a strict absolute due date (e.g. `14.03.2026`) but instead provide a relational temporal clause like `Maksetähtaeg: tasuda 14 päeva jooksul` (Payment deadline: pay within 14 days), the AI historically hallucinates or returns `null` because it only scans for absolute DD.MM.YYYY strings.
- **Mandate**: The Doc AI Extraction payload MUST perform absolute mathematical calendar addition when explicit dates are absent but relational conditions ("päeva jooksul") are detected.
- **Action**: The Claude System Prompt explicitly forces the extraction engine to take the `invoiceDate` and mathematically add the `X` days integer to calculate the exact `YYYY-MM-DD` output string.

## 18. THE ABSOLUTE DATE FALLBACK (RECEIPTS)
- **The Error**: Pre-paid retail receipts (Google Workspace, Esvika) and on-the-spot transit invoices (UAB Tranzito) do not physically possess `Maksetähtaeg` text because the service is rendered concurrently with payment. The AI historically outputted `NOT_FOUND_ON_INVOICE`, causing the Vue/React UI to artificially default their visualization to whatever the current system date happens to be (e.g., jumping to today's date).
- **Mandate**: Active temporal parameters can never be `null`.
- **Action**: Rule 9 was injected into `document_ai_service.cjs` coercing Claude 3.5 Sonnet to clone the `dateCreated` and perfectly mirror it onto the `dueDate` parameter whenever absolute/relational deadlines are absent.

## 19. THE HISTORIC PROFORMA OVERRIDE (IMAP ARCHIVE PIERCING)
- **The Error**: The Rule 2 "Ettemaksuteatis" filter was implemented late in the project lifecycle. Consequently, historic Pro-forma invoices (e.g. Esvika Elekter AS from Aug 2025) structurally masqueraded as final invoices and wrongfully consumed the 733.39 EUR bank reconciliation, preventing the real subsequent invoice from ever surfacing.
- **Mandate**: The system must mechanically vaporize the fake invoice from Firestore and retroactively mine the mail server to locate the real PDF.
- **Action**: The `search_agent.cjs` was structurally rewritten to pierce the strict `2026-01-01` search boundary, extending its IMAP protocol back to `01-Jan-2025` to guarantee physical retrieval of deeply archived chronological anomalies.

## 20. THE SYNONYMOUS MERCHANT PROTOCOL (ALIAS REGISTRY)
- **The Error**: Global tech companies frequently bill bank statements under distinct product consumer brands (e.g., `Claude.ai Subscription`), yet issue their B2B corporate tax invoices under their strict legal parent entity names (e.g., `Anthropic, PBC`). Because the substrings `claude` and `anthropic` do not computationally overlap, the AI fails to mathematically reconcile matching numeric transactions.
- **Mandate**: The Priority Queue must deploy a rigid Semantic Alias substitution matrix prior to executing fuzzy overlap math.
- **Action**: In `index.js`, the `vendorAliases` map intercepts incoming bank description strings. If it detects `claude`, it explicitly forces the semantic vector to `anthropic` before cross-referencing against the active invoice array, unconditionally guaranteeing perfect string matches irrespective of divergent commercial branding.

## 21. THE COMPOUNDING DEBT TRAP (VÕLGNEVUS ISOLATION)
- **The Error**: Invoices from leasing or utility vendors (e.g., Täisteenusliisingu AS) frequently carry over unpaid balances from previous months (labeled as `Võlgnevus`). Legally, that previous month's invoice is already actively circulating in the Firestore database. If the AI extracts the printed "Total to Pay" (`Tasuda`), it structurally double-counts the historical debt. Worse, the AI historically became confused by the numbers and extracted just the `Võlgnevus` number alone (88.38 EUR) instead of the service charge.
- **Mandate**: The AI must physically isolate the mathematical value of the CURRENT document, ignoring all historical debt carry-overs.
- **Action**: Rule 10 was deployed to the DocAI payload. The AI is now violently coerced into calculating the final document `amount` strictly as `Subtotal (Summa km-ta) + Tax (Käibemaks)`. By anchoring the extraction to pure line-item addition, bounding errors induced by compounding arrears are mathematically eliminated.
