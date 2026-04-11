# Invoice Tracker

**AI-powered invoice bookkeeping for freelancers and small teams.**

Invoice Tracker reads invoices straight out of your inbox, extracts every
field with Azure Document Intelligence + Claude, reconciles them against
bank statements, and pushes the result into Merit Aktiva. Built for people
who would rather ship work than copy numbers into Excel.

🔗 **Live:** [invoicetracker.app](https://invoicetracker.app) _(placeholder — update after launch)_
📖 **Launch playbook:** [LAUNCH.md](./LAUNCH.md)

---

## What it does

- **📥 Email → invoice.** IMAP polls your Outlook / Gmail / custom mailbox.
  Every PDF attachment becomes a structured invoice record.
- **🤖 Two-agent OCR + validation.** A "Scout" agent (Azure Document
  Intelligence) extracts raw fields. A "Teacher" agent (Claude Haiku)
  cross-checks each field against the vendor's previous invoices and
  flags anomalies — amount jumps, currency swaps, bad VAT numbers, VIES
  mismatches, anything that doesn't look right. Hallucinations caught
  before they hit your books.
- **💶 Bank reconciliation.** Drop a CSV or XLSX statement from your
  bank and every transaction auto-matches an invoice. Handles partial
  payments, FX conversion, bank fees, and Revolut-style fee absorption.
- **🔗 Shared Invoice Links.** Generate a public upload URL per supplier.
  They drop a PDF on an anonymous landing page; the file lands in your
  dashboard 5 seconds later through the same extraction pipeline. No
  account needed on their side.
- **🧾 Merit Aktiva integration.** Every successfully extracted invoice
  is pushed to Merit automatically. More accounting integrations
  (Xero, QuickBooks) on the roadmap.
- **🛡 Agent-based safety net.** A "Repairman" sweep detects data quality
  issues post-hoc, a "Self-Invoice Guard" catches the classic "buyer
  name leaked into vendor" mistake, and an anomaly detector uses
  12-month vendor history + Z-scores to flag outliers.

## Pricing

| Plan | Monthly | Annual | Credits | Companies | Notes |
|------|---------|--------|---------|-----------|-------|
| **FREE** | €0 | — | 50 / month | 1 | No card required |
| **PRO** | €29 | €290 | 500 / month | 5 | 14-day free trial, bank reconciliation |
| **BUSINESS** | €79 | €790 | 2000 / month | ∞ | Merit Aktiva, 10 seats, priority support |

Credits never expire, unused balance rolls over via one-time credit
packs. Run out mid-month? Manual entry still works — AI just pauses
until the next reset. No forced downgrades, no paywalled CRUD.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│ IMAP mailbox│────▶│  Scout agent │────▶│  Teacher   │
└─────────────┘     │  (Azure OCR) │     │  (Claude)  │
                    └──────────────┘     └──────┬─────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│ Bank CSV    │────▶│ Reconciler   │◀────│  Firestore │
│ upload      │     │              │     │            │
└─────────────┘     └──────────────┘     └──────┬─────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│ Merit Aktiva│◀────│  Sync agent  │     │ Repairman  │
│ (accounting)│     │              │     │ (sweeps)   │
└─────────────┘     └──────────────┘     └────────────┘
```

**Stack:**

- **Frontend:** React 19 + Vite + TypeScript + Firebase client SDK + PWA
- **Backend:** Node.js + Express + Firebase Admin SDK on Railway
- **OCR:** Azure Document Intelligence (Form Recognizer)
- **AI:** Anthropic Claude Haiku (validation, repair, categorization)
- **Persistence:** Cloud Firestore + Cloud Storage
- **Billing:** Lemon Squeezy (Merchant of Record — handles EU VAT)
- **File archival:** Dropbox saga pattern for original PDFs

## Monorepo layout

```
src/                      Frontend React app
automation/               Backend agents
├── core/                 Shared utilities (billing, firebase, date, dedup)
├── tests/                Unit test suites (plain node, no framework)
├── api_server.cjs        HTTP API entry point
├── webhook_server.cjs    Express app + webhook handlers
├── imap_daemon.cjs       IMAP polling worker
├── invoice_processor.cjs Main write path
├── document_ai_service.cjs Scout agent
├── teacher_agent.cjs     Teacher agent
├── repairman_agent.cjs   Data-quality sweeper
├── billing_service.cjs   Lemon Squeezy integration + credits
├── share_links_service.cjs Viral loop
└── merit_sync.cjs        Merit Aktiva integration
firestore.rules           Firestore security rules
storage.rules             Firebase Storage security rules
_agents/pipeline/         Claude ↔ Perplexity continuous-review loop
memory/                   Persistent rules + project context for Claude
CLAUDE.md                 Working rules for the Claude agent
LAUNCH.md                 Launch playbook (ProductHunt / IH / Twitter)
```

## Development

```bash
# Install deps
npm install
cd automation && npm install && cd ..

# Run frontend dev server
npm run dev

# Run backend API
node automation/api_server.cjs

# Run IMAP daemon (background worker)
node automation/imap_daemon.cjs

# Run Repairman sweep (dry-run default, --fix to apply)
node automation/repairman_agent.cjs --mode audit

# Run user migration (dry-run default, --fix to apply)
node automation/migrate_users_to_billing.cjs

# Run full test suite (14 files, 333 tests)
for f in automation/tests/*.test.cjs; do node "$f"; done
```

## Deployment

Railway auto-deploys every merge to `main`. Poll `/health` for the
current commit hash:

```bash
curl https://invoice-tracker-backend-production.up.railway.app/health
bash scripts/wait_deploy.sh
```

Firestore + Storage rules deploy separately via the Firebase CLI:

```bash
npx firebase deploy --only firestore:rules,storage
```

## Security posture

- **Client-side uploads to Storage are blocked** (`allow write: if false`).
  All file writes go through the Admin SDK after the backend derives
  `companyId` from a trusted source.
- **`/api/*` requires a Firebase ID token.** Two public exceptions:
  - `/api/lemon-webhook` — HMAC SHA-256 signature check
  - `/api/share/:token/*` — 32-char crypto-random token + upload cap + TTL
- **Billing documents are write-only via Admin SDK.** Clients can read
  their own billing state but cannot grant themselves credits or upgrade
  plans via direct Firestore writes.
- **Audit logging.** Every billing event (subscription change, credit
  spend) lands in the `billing_events` collection with a webhook
  idempotency key so replays are no-ops.
- **Cross-tenant isolation.** `companyId` is scoped on every query;
  `getBillableUidForCompany` resolves ownership through explicit
  `billingOwnerUid` → `account.ownerUid` → first account admin, never
  via client-supplied values.

Full hardening checklist in [LAUNCH.md § 1](./LAUNCH.md).

## License

TBD — proprietary for now, a LICENSE file will land before any
component goes open-source.

## Contact

Built by **Einar Luha**. Bug reports and feature requests welcome —
open a GitHub issue or drop an email to the address on the landing page.
