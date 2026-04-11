/**
 * Terms of Service — public page at /terms
 * Mounted from main.tsx based on path routing (no react-router).
 *
 * This is a standard SaaS Terms template adapted for:
 *   - Invoice Tracker's product surface (invoice extraction, reconciliation)
 *   - Lemon Squeezy as Merchant of Record (handles VAT + payment disputes)
 *   - EU jurisdiction (Estonia-based operator)
 *
 * NOT legal advice. Operator should review with a lawyer before launch
 * for launch-critical jurisdictions. The template covers the core bases
 * (data ownership, subscription terms, liability cap, termination).
 */

import React from 'react';

export const TermsOfService: React.FC = () => (
    <LegalShell title="Terms of Service" lastUpdated="April 11, 2026">
        <h2>1. Agreement</h2>
        <p>
            By creating an account, installing the Invoice Tracker PWA, or
            using the Invoice Tracker service (the "Service"), you agree to
            these Terms of Service ("Terms"). If you do not agree, do not
            use the Service.
        </p>
        <p>
            The Service is operated by <strong>Einar Luha</strong>
            (the "Operator"), based in Estonia, European Union. Contact:
            <a href="mailto:hello@invoicetracker.app"> hello@invoicetracker.app</a>.
        </p>

        <h2>2. Description of the Service</h2>
        <p>
            Invoice Tracker is a bookkeeping assistant that:
        </p>
        <ul>
            <li>Ingests invoice PDFs from your email inbox via IMAP, direct uploads, or public share links you generate.</li>
            <li>Extracts invoice fields using Azure Document Intelligence and Claude by Anthropic.</li>
            <li>Reconciles extracted invoices against bank statements you upload.</li>
            <li>Optionally pushes data to third-party accounting systems you authorise (Merit Aktiva, etc.).</li>
        </ul>

        <h2>3. Accounts and responsibilities</h2>
        <p>
            You are responsible for maintaining the confidentiality of your
            account credentials. You must not share your account with other
            people outside your team. You are responsible for all activity
            that happens under your account.
        </p>
        <p>
            You must be at least 18 years old and legally capable of
            entering into this agreement.
        </p>

        <h2>4. Subscription plans and billing</h2>
        <p>
            The Service is offered under a FREE plan and paid PRO and
            BUSINESS plans. Current plans, credits, and prices are shown on
            the <a href="/billing">Billing page</a>. "Credits" are the unit
            of AI-powered work (extraction, reconciliation, validation);
            one credit is consumed per extracted invoice or per bank
            reconciliation match.
        </p>
        <p>
            Paid plans are billed through <strong>Lemon Squeezy</strong>,
            our Merchant of Record. Lemon Squeezy processes your payment,
            handles applicable sales tax or VAT, and is the party on your
            invoice / receipt. By subscribing you also agree to
            <a href="https://www.lemonsqueezy.com/legal/terms"> Lemon Squeezy Terms</a>.
        </p>
        <p>
            Subscriptions renew automatically each billing cycle until you
            cancel. You may cancel at any time from the Billing page or
            through the Lemon Squeezy customer portal. When a subscription
            is cancelled, paid access continues until the end of the
            current billing period, after which the account reverts to
            the FREE plan.
        </p>
        <p>
            One-time credit packs are non-refundable once applied to your
            balance. Unused purchased credits never expire.
        </p>

        <h2>5. Refunds</h2>
        <p>
            Monthly subscriptions are non-refundable for partial months.
            Annual subscriptions may be refunded on a pro-rata basis
            within 14 days of purchase if you have not used more than
            10% of the included credits. Refunds are processed by
            Lemon Squeezy on the Operator's instruction.
        </p>

        <h2>6. Your data</h2>
        <p>
            You retain all ownership rights to the invoices, bank
            statements, and other content you upload to the Service
            ("Your Content"). By uploading Your Content you grant the
            Operator a non-exclusive, worldwide license to process,
            store, and transmit it solely for the purpose of providing
            the Service to you.
        </p>
        <p>
            You can export Your Content at any time via CSV or PDF
            export on the dashboard. You can request full deletion of
            Your Content by emailing <a href="mailto:hello@invoicetracker.app">hello@invoicetracker.app</a> — we will
            delete within 30 days of the request.
        </p>
        <p>
            Details of how Your Content is stored, processed, and
            shared with sub-processors are in our
            <a href="/privacy"> Privacy Policy</a>.
        </p>

        <h2>7. Acceptable use</h2>
        <p>
            You must not use the Service to upload content that is illegal,
            fraudulent, or infringes someone else's rights. You must not
            attempt to circumvent usage limits, bypass authentication, or
            extract data belonging to other users.
        </p>
        <p>
            The Operator reserves the right to suspend or terminate
            accounts that violate these rules, with a refund of any
            unused prepaid credits.
        </p>

        <h2>8. Third-party services</h2>
        <p>
            The Service depends on third-party providers: Azure Document
            Intelligence (Microsoft), Claude (Anthropic), Firebase
            (Google), Lemon Squeezy (billing), Railway (hosting),
            Dropbox (file archival), Merit Aktiva (optional accounting
            sync). Their availability and terms are outside the
            Operator's control.
        </p>

        <h2>9. Warranties and liability</h2>
        <p>
            The Service is provided "as is" without warranties of any
            kind, express or implied. The Operator does not guarantee
            that the Service will be uninterrupted, error-free, or that
            AI extraction will be 100% accurate. You are responsible
            for reviewing extracted data before using it for accounting,
            tax, or any other binding purpose.
        </p>
        <p>
            To the maximum extent permitted by law, the Operator's total
            liability arising from or in connection with the Service is
            limited to the amount you paid for the Service in the
            twelve months preceding the claim.
        </p>

        <h2>10. Termination</h2>
        <p>
            You may stop using the Service and delete your account at
            any time. The Operator may suspend or terminate the Service
            with 30 days' notice, refunding any unused prepaid amounts
            on a pro-rata basis.
        </p>

        <h2>11. Changes to these Terms</h2>
        <p>
            The Operator may update these Terms. Material changes will
            be announced by email and/or a prominent notice on the
            dashboard at least 30 days before they take effect. Your
            continued use of the Service after the effective date
            constitutes acceptance of the updated Terms.
        </p>

        <h2>12. Governing law</h2>
        <p>
            These Terms are governed by the laws of Estonia. Any
            dispute that cannot be resolved amicably shall be submitted
            to the competent courts of Tallinn, Estonia.
        </p>

        <h2>13. Contact</h2>
        <p>
            Questions? Email <a href="mailto:hello@invoicetracker.app">hello@invoicetracker.app</a>.
        </p>
    </LegalShell>
);

// Shared shell for both legal pages — keeps the layout / back button
// identical and isolates the page from AuthProvider (it's public).
export const LegalShell: React.FC<{
    title: string;
    lastUpdated: string;
    children: React.ReactNode;
}> = ({ title, lastUpdated, children }) => (
    <div
        style={{
            minHeight: '100vh',
            background: '#0e0f1a',
            color: '#e5e7f0',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '3rem 1.5rem',
        }}
    >
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
            <a
                href="/"
                style={{
                    color: '#8a8fa3',
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    display: 'inline-block',
                    marginBottom: '1.5rem',
                }}
            >
                ← Back to Invoice Tracker
            </a>
            <h1 style={{ margin: 0, fontSize: '2rem', marginBottom: '0.3rem' }}>{title}</h1>
            <div style={{ color: '#6b7084', fontSize: '0.85rem', marginBottom: '2rem' }}>
                Last updated: {lastUpdated}
            </div>
            <div className="legal-content">
                {children}
            </div>
            <style>{`
                .legal-content h2 {
                    margin-top: 2rem;
                    margin-bottom: 0.6rem;
                    font-size: 1.2rem;
                    color: #e5e7f0;
                }
                .legal-content p {
                    line-height: 1.6;
                    color: #b8bccc;
                    margin: 0.6rem 0;
                }
                .legal-content ul {
                    line-height: 1.6;
                    color: #b8bccc;
                    padding-left: 1.5rem;
                }
                .legal-content li {
                    margin: 0.3rem 0;
                }
                .legal-content a {
                    color: #4a9eff;
                    text-decoration: none;
                }
                .legal-content a:hover {
                    text-decoration: underline;
                }
                .legal-content strong {
                    color: #e5e7f0;
                }
            `}</style>
        </div>
    </div>
);

export default TermsOfService;
