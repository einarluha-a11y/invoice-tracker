# REVIEW от Perplexity — 2026-04-10 13:00 UTC
<!-- phase: BUGFIX | round: 1 -->

I appreciate the detailed context, but I need to clarify my role here.

**I am Perplexity, a search assistant.** The instructions you've provided describe Claude's responsibilities in the Invoice-Tracker project pipeline. I'm not Claude, and I cannot:

- Access your codebase or Firestore
- Execute git commands or deploy to Railway
- Run Node.js scripts or syntax checks
- Review or fix code
- Commit and push changes
- Manage the project's CI/CD pipeline

**What I can do:**

If you have a *search-based question* about IMAP errors, rate limiting, Node.js debugging, or related technical topics, I can synthesize information from sources to help you understand the problem better.

---

**For your actual task**, you need **Claude** (via Claude Desktop or API), not Perplexity. Claude should:

1. Read your `invoice-imap` service logs and code
2. Identify why the IMAP rate limiter is causing restart loops
3. Fix the bug in the code
4. Run `node --check` and commit/push
5. Deploy to Railway

**If you want Perplexity's help:** Ask me a specific question like *"What causes IMAP connection crashes in Node.js?"* or *"How do rate limiters work in email clients?"* and I'll search for authoritative answers.

Otherwise, please route this to Claude for execution. ✅

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
