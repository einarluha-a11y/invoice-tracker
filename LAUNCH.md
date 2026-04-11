# Invoice Tracker — Launch Playbook

> **Status:** pre-launch. Updated sprint 6.

This is the operator's checklist for going from "pre-launch" to "public on
ProductHunt / Indie Hackers / Twitter". Keep it living — cross off items
as they land.

---

## 1. Pre-launch checklist

### Technical (must-have before flipping public)

- [ ] **Lemon Squeezy store is live**
    - [ ] PRO monthly + annual variants created
    - [ ] BUSINESS monthly + annual variants created
    - [ ] Credit pack 100 / 500 / 1000 variants created
    - [ ] 14-day trial enabled on PRO variants
    - [ ] Webhook endpoint pointed at `/api/lemon-webhook`
    - [ ] All eight `LEMON_VARIANT_*` env vars set on Railway
    - [ ] `LEMON_WEBHOOK_SECRET` set on Railway
    - [ ] Seven `VITE_LEMON_CHECKOUT_*` env vars set and a frontend rebuild deployed
- [ ] **Billing rollout**
    - [ ] `BILLING_ENFORCEMENT=shadow` set on Railway for at least 24h
    - [ ] `[Billing:shadow]` log lines reviewed — predicted charges match reality
    - [ ] Migration dry-run matches expectations
    - [ ] Migration `--fix` executed — every existing user has a billing doc
    - [ ] `BILLING_ENFORCEMENT=enforce` set on Railway
- [ ] **End-to-end smoke tests**
    - [ ] Sign up new user → gets 14-day PRO trial with 500 credits
    - [ ] Upload invoice via IMAP → credits decrement in UI
    - [ ] Bank reconciliation match → credits decrement
    - [ ] Hit 80% credits → upgrade modal appears
    - [ ] Complete Lemon Squeezy test checkout → webhook arrives → plan upgrades
    - [ ] Cancel subscription → downgrades to FREE at period end
    - [ ] Credit pack purchase → purchased credits added to balance
    - [ ] Generate share link → anonymous supplier uploads PDF → invoice lands in owner account
    - [ ] Share link cap / expiry / revoke all behave as expected
- [ ] **Hardening**
    - [ ] `/api/lemon-webhook` returns 401 without signature (verified)
    - [ ] `/api/share/create` returns 401 without Firebase token (verified)
    - [ ] `storage.rules` block client-side writes (verified)
    - [ ] `firestore.rules` block client-side billing writes (verified)
    - [ ] Backups: Firestore scheduled export enabled

### Content

- [ ] **Landing page**
    - [ ] Hero headline + subhead locked
    - [ ] 3 screenshots (dashboard / Billing / share link landing)
    - [ ] 30-second demo video (optional but doubles conversion)
    - [ ] Pricing table with FREE / PRO / BUSINESS
    - [ ] Testimonials / social proof (wait until post-launch if none yet)
- [ ] **Docs**
    - [ ] Getting-started guide (how to connect IMAP, create a company)
    - [ ] FAQ: "What happens when credits run out?", "Can I export?", "Is it GDPR-compliant?"
- [ ] **Marketing assets**
    - [ ] ProductHunt gallery (1270x760 px) — 3+ images
    - [ ] Twitter / X cover image
    - [ ] Indie Hackers thumbnail (1200x630 px)

### Legal & admin

- [ ] Terms of service + privacy policy live on the site
- [ ] Lemon Squeezy handles VAT, but ToS must mention they are MoR
- [ ] GDPR data export endpoint available to users
- [ ] Support email inbox (`hello@invoicetracker.app` or similar) monitored

---

## 2. Launch day action plan

### Timezone strategy

Target the US + EU window. **Post at 01:00 UTC** — that's 17:00 San
Francisco (PT), 20:00 New York, 03:00 Tallinn. Gets full Pacific day
one + the European morning on day two. ProductHunt daily rankings
reset at 00:00 UTC so posting just after midnight maximises time on
the front page.

### Coordinated posts

All three channels go within 30 minutes of each other so the first
wave of upvoters / readers also see the Twitter thread:

1. **01:00 UTC** — publish ProductHunt with the copy below
2. **01:10 UTC** — post the Indie Hackers launch thread
3. **01:20 UTC** — fire the Twitter / X thread
4. **01:30 UTC** — share in relevant Slack / Discord communities
   (Estonian Founders, Baltic Startups, Indie Hackers PH launch slack)

### Day-one metrics to track

- ProductHunt upvotes / comments / makers' page visits
- Lemon Squeezy checkouts / conversions
- New FREE signups (migration script output vs post-launch)
- Share link creations + anonymous uploads (viral loop signal)
- `/api/agent-stats` — anomalies caught / errors / credits burnt

Log everything into a scratch file. Post a wrap-up thread 24h later.

---

## 3. ProductHunt copy

### Tagline (60 chars max)

```
Invoice Tracker — AI bookkeeping for freelancers, not CFOs
```

Alt: `AI-powered invoice tracker built for humans, not spreadsheets`

### Short description (260 chars)

```
Invoice Tracker pulls invoices straight from your inbox, extracts
every field with AI, matches bank payments automatically, and
stops pestering you with manual data entry. Built by an Estonian
bookkeeper who was tired of copying numbers into Excel.
```

### Long description (first comment on PH)

```
Hey Hunters 👋

I'm Einar. For the last year I've been quietly building Invoice
Tracker because my own bookkeeping workflow was driving me insane.

The problem: every month I was pulling invoices out of 4 different
email inboxes, OCRing them one by one into Excel, cross-checking
against bank statements, and then pasting the result into Merit
Aktiva. A whole Saturday gone.

The fix:

📥 Email in → invoice out. Hook up your Outlook / Gmail. Every PDF
in your inbox becomes a structured invoice: vendor, invoice ID,
dates, amounts, VAT, line items. No manual data entry.

🤖 Scout + Teacher agents. Azure Document Intelligence reads the
raw PDF, then a Claude-powered "Teacher" cross-checks each field
against the vendor's previous invoices and flags anything odd
(amount jumped 10x? currency changed? VAT number doesn't match
VIES?). Hallucinations caught before they hit your books.

💶 Bank reconciliation for free. Drop a CSV or XLSX statement
from your bank and every line gets matched to an invoice
automatically. Partial payments, FX conversion, bank fees — all
handled.

🔗 Shared Invoice Links. Send a supplier a single link, they drop
the PDF, it's in your dashboard 5 seconds later. No accounts
needed on their end.

🧾 Merit Aktiva sync. If you use Merit (the biggest Estonian
accounting platform), every invoice flows there automatically.
Other integrations on the roadmap.

Pricing

- FREE — 50 AI credits / month, 1 company, unlimited invoice
  count. No card required.
- PRO €29 / month — 500 credits, 5 companies, bank
  reconciliation, 14-day free trial.
- BUSINESS €79 / month — 2000 credits, unlimited companies,
  Merit Aktiva integration, 10 seats, priority support.

Credits never expire. Run out mid-month? Manual entry still
works, AI pauses until next reset. Or top up with a one-time
credit pack. No forced downgrades, no locked features — just
softer when the pool is empty.

Why credits instead of invoice limits? Because "50 invoices /
month" is a psychological trap. Credits reward high-value work
and let heavy users pay per use instead of guessing a plan tier.

Would love to hear what you think. Every AI miss, every weird
PDF format, every vendor pattern we're missing — drop it in the
comments and I'll fix it the same day.

— Einar
```

### Maker comment (second reply, about 2h after launch)

```
If you want to go deep on the stack — we're using Azure Document
Intelligence for OCR, Claude Haiku for cross-validation and
repair, Firebase for persistence, Lemon Squeezy for billing,
Railway for hosting. Open to questions about any of it.
```

---

## 4. Indie Hackers launch post

### Title

```
Launched Invoice Tracker — AI bookkeeping for freelancers (€29/mo)
```

### Body

```markdown
After a year of quietly iterating, I'm launching Invoice Tracker
today. It reads my invoices out of email, OCR + AI-extracts every
field, matches them to bank payments, and pushes to Merit Aktiva.

**The growth lever I'm watching:** Shared Invoice Links. Every user
gets a "drop your invoice here" URL they can send to suppliers.
The supplier uploads a PDF → it lands in the user's dashboard →
the supplier sees "Powered by Invoice Tracker, sign up free". I'm
hoping 1 link converts 0.5 new FREE users on average. We'll see.

**Tech choices I'd defend:**

- **Credits instead of invoice limits.** Charging per invoice
  creates a tracking anxiety. Credits let me price the AI work
  (which has real marginal cost via Azure + Claude) separately
  from the CRUD layer (unlimited on all plans).
- **Firestore + Admin SDK, no custom backend framework.** Express
  is ~500 lines of handlers wrapping a few agent modules. All
  the complexity lives in the agents themselves.
- **Claude as a second opinion.** Scout (Azure OCR) runs first.
  Teacher (Claude Haiku) only runs when Scout is uncertain or
  the document doesn't match a known vendor pattern. Keeps the
  Claude bill predictable.

**Tech choices that surprised me:**

- **Bank reconciliation is 80% of the business value.** I spent
  the first three months perfecting the OCR pipeline. The moment
  I shipped "upload a CSV and I'll match everything" the whole
  feeling of the app changed. Users will happily type OCR misses
  by hand if the reconciliation step is magic.
- **Multi-language OCR matters more than I thought.** Every
  Estonian invoice is bilingual, and half my users deal with
  Lithuanian / Polish suppliers. Per-language prompt hints
  (added in phase 2) roughly halved extraction errors on
  non-English docs.

### Pricing
- FREE: 50 credits / month, 1 company, unlimited invoices
- PRO: €29 / month (or €290 / yr), 500 credits, 5 companies,
  bank reconciliation, 14-day trial
- BUSINESS: €79 / month (or €790 / yr), 2000 credits, unlimited
  companies, Merit Aktiva, 10 seats

### What I'd love feedback on
1. Is the credit system intuitive? I'm worried it sounds like a
   mobile game economy.
2. For the self-employed crowd — is FREE enough to actually be
   useful, or should I up the monthly allowance?
3. Anyone here running a similar viral loop? How'd it go?

Link: https://invoicetracker.app (placeholder — update day-of)
```

---

## 5. Twitter / X thread

### Thread (6 tweets)

```
1/ Launching Invoice Tracker today on @ProductHunt 🚀

AI-powered invoice tracking for freelancers and small teams who
are tired of:
- OCR'ing PDFs into Excel
- Matching bank statements by hand
- Paying for accounting software built for CFOs

[screenshot: dashboard]

2/ The core flow:

📥 Email → invoice. IMAP pulls every PDF attachment.
🤖 Azure OCR + Claude cross-check extract every field.
💶 Drop a bank CSV — every transaction auto-matches an invoice.
🧾 Merit Aktiva push. Done.

You stop being a human OCR engine.

3/ Pricing uses AI credits instead of invoice limits.

FREE: 50 credits / mo
PRO: €29 / mo, 500 credits
BUSINESS: €79 / mo, 2000 credits

Unlimited invoices on every plan. You pay for AI work, not
storage. Credits never expire.

4/ The growth lever: Shared Invoice Links.

Every user gets a public "drop your PDF here" URL. Send it to a
supplier → they upload directly → invoice lands in your dashboard
→ they see "Powered by Invoice Tracker" and a sign-up CTA.

Day one viral loop.

5/ Built with:
- @Azure Document Intelligence (OCR)
- @AnthropicAI Claude (second-opinion validation)
- @firebase Firestore (persistence)
- @lmsqueezy (billing — thanks for handling EU VAT)
- @Railway (hosting)

Single developer. ~12 months part time.

6/ If you run a 1–10 person business and invoice handling is
still manual, please give it a spin:

🔗 https://invoicetracker.app

14-day PRO trial, no credit card, FREE tier forever. Would love
your feedback — every edge case I miss makes the AI better for
the next person.

@ProductHunt launch: [link]
```

---

## 6. Post-launch follow-ups (week 1)

- [ ] Reply to every ProductHunt comment within 2h (set a timer)
- [ ] Monitor Lemon Squeezy webhook for subscription events
- [ ] Check `/api/agent-stats` every 4h for anomaly spikes
- [ ] Thank-you email to every paid subscriber within 24h
- [ ] Post a "day 1 numbers" tweet showing real signup / revenue chart
- [ ] Write a retro blog post by day 7 — successes + misses
- [ ] Feature request backlog — anything repeated more than twice gets fast-tracked

## 7. Known trade-offs to defend (if asked)

- **Per-user billing, not per-account.** Team plans share a seat count but each
  member has their own credit budget. Keeps billing simple; team aggregation
  comes later if BUSINESS demand justifies it.
- **Soft block, not hard block.** When credits hit zero, manual entry still
  works. We chose friction over frustration.
- **Only EU / Estonian-focused on day 1.** Merit Aktiva integration is the
  best-in-class anchor. English + Russian + multi-currency come with
  the rest of the EU expansion post-launch.
- **Shared links are public.** Anyone with the 32-char token can upload. We
  trade convenience (supplier zero-friction drop) against access control
  (time-bound + upload cap + revoke + company scope).
- **No AppSumo / LTD at launch.** Lifetime deals mortgage future MRR for
  current cash. Revisit after 6 months if the free tier isn't converting.

## 8. Rollback plan (if launch goes sideways)

### Billing gone wrong

1. `railway variables --set BILLING_ENFORCEMENT=shadow` — instant rollback
   to shadow mode, credits stop debiting. Then `off` if that's still noisy.
2. Manually restore any billing docs from the `billing_events` audit
   collection + any Lemon Squeezy dashboard data.
3. Email affected users within 1h with a clear explanation + compensation.

### Share links abused

1. `UPDATE share_links SET revoked = true` for the offending token.
2. Rate limits on `/api/share/:token/upload` already prevent brute force.
3. If a whole company is targeted, delete all their share_links and
   issue new ones. Audit log in `share_uploads` shows source IPs.

### Lemon Squeezy webhook failing

1. Events are retried automatically on 5xx. Logs in Railway.
2. Idempotency ledger (`billing_events/{eventId}`) prevents double-
   applying anything.
3. Worst case: pause subscription on LS side, manually sync via
   Admin SDK, then re-enable.

---

_This file is version-controlled — update it when reality diverges
from the plan. The launch is not the end, just the noisiest moment
in the roadmap._
