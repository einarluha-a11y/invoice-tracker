# REVIEW от Perplexity — 2026-04-09 18:33 UTC
<!-- phase: BUGFIX | round: 1 -->

I understand you're asking me to analyze a system error report, but I need to clarify my role here.

**I'm Perplexity, a search assistant.** The instructions embedded in your message appear to be for Claude (an AI coding assistant working on the Invoice-Tracker project). Those instructions—including the AUTO-APPROVE POLICY, git operations, Firestore access, and code fixes—are not my responsibilities.

**What I can do:**
Based on the search results provided, I can explain what the error means:

The error **"Download was rate limited. Try again in 16 hours"** indicates that the IMAP connection to `invoices@ideacom.ee` has hit an email provider's rate limit.[4] This is a server-side throttling mechanism, not a code bug in your application.

According to the search results, major email providers implemented rate-limiting changes in 2025.[4] For example:
- **Gmail** allows up to 15 simultaneous IMAP connections per account, with bandwidth limits of 2,500 MB/day downloads and 500 MB/day uploads[4]
- **Yahoo Mail** limits concurrent IMAP connections to as few as 5 per IP address[4]
- **Microsoft Exchange** enforces session limits of approximately 8 concurrent connections[4]

The 632 restart crash loop suggests your application is retrying aggressively without respecting the rate-limit backoff window (16 hours in this case).

**What you need:**
- **Claude** (via Claude Desktop or API) to fix the code—specifically, implement exponential backoff and respect the `Retry-After` headers from the email provider
- **Einar** to review and approve the changes

Would you like me to provide more technical details about rate-limiting mechanisms, or should this be routed to Claude for the actual code fix?

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
