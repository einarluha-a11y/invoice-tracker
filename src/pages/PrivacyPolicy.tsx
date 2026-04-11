/**
 * Privacy Policy — public page at /privacy
 *
 * GDPR-oriented template adapted for Invoice Tracker's actual data flows:
 *   - IMAP email ingestion (we touch user's inbox)
 *   - Azure Document Intelligence (OCR sub-processor)
 *   - Claude by Anthropic (AI sub-processor)
 *   - Firebase (storage + auth sub-processor, Google Cloud EU)
 *   - Lemon Squeezy (billing sub-processor, handles payment PII)
 *   - Dropbox (optional file archival)
 *
 * Covers: what we collect, why, how long, who we share with, user rights.
 * Reviewed before launch by a lawyer.
 */

import React from 'react';
import { LegalShell } from './TermsOfService';

export const PrivacyPolicy: React.FC = () => (
    <LegalShell title="Privacy Policy" lastUpdated="April 11, 2026">
        <p>
            This Privacy Policy explains what personal data Invoice Tracker
            collects, how it is used, who it is shared with, and what
            rights you have. We care about privacy because we handle
            financial documents on behalf of small teams, and trust is
            the whole point.
        </p>

        <h2>1. Who we are</h2>
        <p>
            The data controller is <strong>Einar Luha</strong>, based in
            Estonia, European Union. Contact:
            <a href="mailto:hello@invoicetracker.app"> hello@invoicetracker.app</a>.
        </p>

        <h2>2. Data we collect</h2>
        <h3>2.1 From your account</h3>
        <ul>
            <li><strong>Email address</strong> — required for account creation and support</li>
            <li><strong>Display name</strong> — from Google OAuth when you sign in with Google</li>
            <li><strong>Authentication tokens</strong> — stored client-side by Firebase Auth</li>
        </ul>

        <h3>2.2 From your invoices</h3>
        <ul>
            <li><strong>Invoice PDFs</strong> — the original files you upload or that arrive via IMAP</li>
            <li><strong>Extracted fields</strong> — vendor name, amounts, dates, VAT numbers, invoice IDs, line items</li>
            <li><strong>Bank statement rows</strong> — transaction date, amount, counterparty, reference</li>
        </ul>

        <h3>2.3 From your mailbox (IMAP)</h3>
        <p>
            If you configure an IMAP mailbox in Seaded, we connect to that
            mailbox on a schedule and read new messages. We only extract
            PDF attachments that look like invoices. We do not store the
            body of other messages. IMAP credentials you enter are
            encrypted at rest in Firestore.
        </p>

        <h3>2.4 Technical</h3>
        <ul>
            <li><strong>IP address</strong> — for rate limiting and abuse prevention (share link uploads, API rate limits)</li>
            <li><strong>Browser / device info</strong> — for security auditing</li>
            <li><strong>Usage telemetry</strong> — credit consumption, failed extractions, feature usage</li>
        </ul>

        <h2>3. Why we use your data</h2>
        <ul>
            <li><strong>Provide the Service</strong> — extraction, reconciliation, reporting</li>
            <li><strong>Improve AI accuracy</strong> — anonymized extraction errors help us tune prompts (see § 6)</li>
            <li><strong>Billing</strong> — plan enforcement, credit tracking, invoice for Lemon Squeezy</li>
            <li><strong>Support</strong> — responding to questions and bug reports</li>
            <li><strong>Security</strong> — detecting fraud, brute force, abuse</li>
            <li><strong>Legal compliance</strong> — responding to valid legal requests</li>
        </ul>

        <h2>4. Legal basis (GDPR Art. 6)</h2>
        <ul>
            <li><strong>Contract</strong> (Art. 6(1)(b)) — processing necessary to provide the Service you subscribed to</li>
            <li><strong>Legitimate interest</strong> (Art. 6(1)(f)) — security, fraud prevention, improving the Service</li>
            <li><strong>Legal obligation</strong> (Art. 6(1)(c)) — tax records retention, responding to legal orders</li>
        </ul>

        <h2>5. Who we share with</h2>
        <p>
            We use the following sub-processors. Each one is bound by a
            Data Processing Agreement and EU data transfer safeguards.
        </p>
        <ul>
            <li><strong>Microsoft Azure</strong> — Document Intelligence OCR. EU-hosted resource. Invoice PDFs are sent for OCR and not retained by Azure after processing.</li>
            <li><strong>Anthropic (Claude)</strong> — AI validation and repair. Only invoice text is sent, not full PDFs. Anthropic processes in US region under Standard Contractual Clauses.</li>
            <li><strong>Google Firebase</strong> — authentication, Firestore database, Cloud Storage. EU multi-region.</li>
            <li><strong>Railway</strong> — backend hosting. EU region.</li>
            <li><strong>Lemon Squeezy</strong> — billing and payment processing. Merchant of Record — they are the counterparty on your invoice, not us. They handle card data; we never see card numbers.</li>
            <li><strong>Dropbox</strong> — optional long-term file archival for customers who enable it.</li>
            <li><strong>Merit Aktiva</strong> — optional accounting sync for customers on the BUSINESS plan.</li>
        </ul>
        <p>
            We do not sell your data to anyone. Ever.
        </p>

        <h2>6. AI training</h2>
        <p>
            We do not use your invoices to train public AI models. Claude
            and Azure are configured to not retain your content for
            training. Our own "Teacher" agent learns vendor-specific
            patterns from your own invoices within your own account —
            these patterns never leak to other customers.
        </p>

        <h2>7. How long we keep data</h2>
        <ul>
            <li><strong>Active accounts</strong>: as long as you use the Service.</li>
            <li><strong>Deleted accounts</strong>: 30 days after deletion request, then purged from Firestore and Storage.</li>
            <li><strong>Invoice records</strong>: you can delete individual invoices anytime. Archived invoices are kept until you remove them.</li>
            <li><strong>Billing records</strong>: 7 years (Estonian tax law requires this).</li>
            <li><strong>Audit logs</strong>: 2 years for security investigations.</li>
        </ul>

        <h2>8. Your rights (GDPR)</h2>
        <p>As an EU data subject, you have the right to:</p>
        <ul>
            <li><strong>Access</strong> — get a copy of your personal data</li>
            <li><strong>Rectification</strong> — correct inaccurate data</li>
            <li><strong>Erasure</strong> ("right to be forgotten") — ask us to delete your data</li>
            <li><strong>Portability</strong> — export your data in a machine-readable format (CSV/JSON)</li>
            <li><strong>Objection</strong> — object to processing based on legitimate interest</li>
            <li><strong>Restriction</strong> — ask us to pause processing while a dispute is resolved</li>
            <li><strong>Complaint</strong> — lodge a complaint with the Estonian Data Protection Inspectorate (<a href="https://www.aki.ee/en" target="_blank" rel="noopener">aki.ee</a>) or your local authority</li>
        </ul>
        <p>
            To exercise any of these rights, email
            <a href="mailto:hello@invoicetracker.app"> hello@invoicetracker.app</a>.
            We respond within 30 days.
        </p>

        <h2>9. Security</h2>
        <ul>
            <li>All traffic is HTTPS with TLS 1.3.</li>
            <li>Authentication is handled by Firebase Auth (Google-grade).</li>
            <li>Backend writes go through Admin SDK — clients cannot bypass Firestore security rules.</li>
            <li>File writes to Cloud Storage are blocked from the client side entirely; everything goes through backend validation.</li>
            <li>Billing and credit data are write-only via server-side webhooks — clients cannot grant themselves credits.</li>
            <li>Audit logs of every billing event and share link upload are retained for 2 years.</li>
        </ul>
        <p>
            We will notify you without undue delay (and in any case within
            72 hours) if we become aware of a breach that affects your
            personal data.
        </p>

        <h2>10. Cookies and tracking</h2>
        <p>
            We use only essential cookies needed for authentication and
            session management. No advertising, no behavioural tracking,
            no third-party analytics on the application itself. The
            landing page uses a single privacy-respecting analytics
            service (Plausible / Simple Analytics — configured without
            personal identifiers).
        </p>

        <h2>11. International transfers</h2>
        <p>
            Most of your data stays in the EU. Claude (Anthropic) processes
            data in the United States under Standard Contractual Clauses
            approved by the European Commission. You can request that we
            disable the AI validation step for your account, in which case
            invoices will be extracted by Azure only — at some cost to
            accuracy for non-standard documents.
        </p>

        <h2>12. Children</h2>
        <p>
            The Service is not intended for users under 18. We do not
            knowingly collect data from minors. If you believe we have
            data from a minor, email us and we will delete it.
        </p>

        <h2>13. Changes</h2>
        <p>
            We may update this Policy. Material changes will be
            announced by email or a prominent dashboard notice at least
            30 days before taking effect.
        </p>

        <h2>14. Contact</h2>
        <p>
            Data Protection Officer: <a href="mailto:hello@invoicetracker.app">hello@invoicetracker.app</a>.
            We will respond within 30 days to any GDPR request.
        </p>
    </LegalShell>
);

export default PrivacyPolicy;
