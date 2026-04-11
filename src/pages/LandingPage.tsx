/**
 * Public landing page — /landing
 *
 * Marketing page for ProductHunt / Indie Hackers / Twitter traffic.
 * Self-contained, no AuthProvider, no Firebase call. Pure static HTML
 * so it loads fast even on cold cache.
 *
 * Sections:
 *   1. Hero — headline, subhead, primary CTA
 *   2. Problem / Solution — three-up
 *   3. How it works — four-step flow
 *   4. Pricing table (mirrors Billing.tsx)
 *   5. Feature details
 *   6. Final CTA
 *   7. Footer with legal links
 *
 * Kept on /landing (not /) for now so existing signed-in users who have
 * "/" bookmarked still reach the app. Once Einar is ready, we swap the
 * root to route anonymous visitors to /landing automatically.
 */

import React from 'react';

export const LandingPage: React.FC = () => (
    <div style={shellStyle}>
        <Nav />
        <Hero />
        <ProblemSolution />
        <HowItWorks />
        <Pricing />
        <Features />
        <FinalCTA />
        <Footer />
        <style>{css}</style>
    </div>
);

const shellStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0e0f1a',
    color: '#e5e7f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
};

// ─── Nav ──────────────────────────────────────────────────────────────
const Nav: React.FC = () => (
    <nav className="lp-nav">
        <div className="lp-nav-inner">
            <a href="/landing" className="lp-logo">
                <span aria-hidden="true">📄</span>
                <span>Invoice-<span className="lp-accent">Tracker</span></span>
            </a>
            <div className="lp-nav-links">
                <a href="#pricing">Pricing</a>
                <a href="#features">Features</a>
                <a href="/" className="lp-nav-cta">Open app</a>
            </div>
        </div>
    </nav>
);

// ─── Hero ─────────────────────────────────────────────────────────────
const Hero: React.FC = () => (
    <section className="lp-hero">
        <div className="lp-hero-inner">
            <div className="lp-pill">🪙 AI bookkeeping · for humans</div>
            <h1>
                Stop copying invoices<br />
                into Excel. Forever.
            </h1>
            <p className="lp-subhead">
                Invoice Tracker pulls PDFs straight from your inbox,
                extracts every field with Azure + Claude, matches bank
                payments automatically, and stops pestering you with
                manual data entry.
            </p>
            <div className="lp-cta-row">
                <a href="/" className="lp-btn lp-btn-primary">
                    Start free — no card →
                </a>
                <a href="#pricing" className="lp-btn lp-btn-secondary">
                    See pricing
                </a>
            </div>
            <div className="lp-hero-notes">
                14-day PRO trial · Unlimited invoices on every plan ·
                Cancel anytime
            </div>
        </div>
    </section>
);

// ─── Problem / Solution ──────────────────────────────────────────────
const ProblemSolution: React.FC = () => (
    <section className="lp-section lp-ps">
        <h2 className="lp-section-title">Built because our Saturdays were gone</h2>
        <div className="lp-ps-grid">
            <div className="lp-ps-col lp-ps-problem">
                <div className="lp-ps-emoji">😫</div>
                <h3>Before</h3>
                <ul>
                    <li>OCR'ing PDFs into Excel one by one</li>
                    <li>Matching bank statements by hand</li>
                    <li>Hunting down the "correct" VAT on the 4th page</li>
                    <li>Losing an entire Saturday every month</li>
                </ul>
            </div>
            <div className="lp-ps-col lp-ps-solution">
                <div className="lp-ps-emoji">🚀</div>
                <h3>After</h3>
                <ul>
                    <li>Email lands → invoice appears in dashboard</li>
                    <li>CSV upload → every transaction auto-matched</li>
                    <li>Teacher agent catches AI mistakes before they hit your books</li>
                    <li>Review-then-approve flow in under 5 minutes</li>
                </ul>
            </div>
        </div>
    </section>
);

// ─── How it works ─────────────────────────────────────────────────────
const HowItWorks: React.FC = () => (
    <section className="lp-section lp-how">
        <h2 className="lp-section-title">How it works</h2>
        <div className="lp-steps">
            <Step n={1} emoji="📥" title="Email → invoice">
                Hook up your Outlook, Gmail, or custom IMAP. Every PDF
                attachment becomes a structured invoice.
            </Step>
            <Step n={2} emoji="🤖" title="Scout + Teacher extract">
                Azure Document Intelligence reads the raw PDF. Claude
                cross-checks every field against vendor history and flags
                anything odd.
            </Step>
            <Step n={3} emoji="💶" title="Bank auto-reconcile">
                Drop a CSV or XLSX from your bank. Each line is matched to
                an invoice. Partial payments, FX, bank fees — all handled.
            </Step>
            <Step n={4} emoji="🧾" title="Push to accounting">
                Merit Aktiva sync on BUSINESS. CSV / PDF export on every
                plan. Your books stay in your system, we're just the
                bridge.
            </Step>
        </div>
    </section>
);

const Step: React.FC<{ n: number; emoji: string; title: string; children: React.ReactNode }> = ({
    n, emoji, title, children,
}) => (
    <div className="lp-step">
        <div className="lp-step-num">{n}</div>
        <div className="lp-step-emoji">{emoji}</div>
        <h3>{title}</h3>
        <p>{children}</p>
    </div>
);

// ─── Pricing ──────────────────────────────────────────────────────────
const Pricing: React.FC = () => (
    <section id="pricing" className="lp-section lp-pricing">
        <h2 className="lp-section-title">Simple, usage-based pricing</h2>
        <p className="lp-section-sub">
            Every plan has <strong>unlimited invoices</strong>. You pay
            for the AI work, not the storage. Run out of credits?
            Manual entry still works until next month.
        </p>
        <div className="lp-pricing-grid">
            <PriceCard
                name="FREE"
                price="€0"
                period="forever"
                features={[
                    'Unlimited invoices',
                    '50 AI credits / month',
                    '1 company',
                    '500 MB storage',
                    'PDF export',
                ]}
                cta="Start free"
                ctaHref="/"
            />
            <PriceCard
                name="PRO"
                price="€29"
                period="/ month"
                badge="Most popular"
                highlight
                features={[
                    'Unlimited invoices',
                    '500 AI credits / month',
                    'Up to 5 companies',
                    '10 GB storage',
                    'Bank reconciliation',
                    'Email support',
                    'Credit packs €0.05 each',
                ]}
                cta="14-day free trial"
                ctaHref="/"
            />
            <PriceCard
                name="BUSINESS"
                price="€79"
                period="/ month"
                features={[
                    'Unlimited invoices',
                    '2000 AI credits / month',
                    'Unlimited companies',
                    '100 GB storage',
                    'Merit Aktiva integration',
                    'Up to 10 team seats',
                    'Dedicated manager',
                    'Credit packs €0.03 each',
                ]}
                cta="14-day free trial"
                ctaHref="/"
            />
        </div>
        <p className="lp-pricing-note">
            Save ~17% on annual billing. Credit packs (100 / 500 / 1000)
            roll over and never expire.
        </p>
    </section>
);

interface PriceCardProps {
    name: string;
    price: string;
    period: string;
    features: string[];
    cta: string;
    ctaHref: string;
    badge?: string;
    highlight?: boolean;
}
const PriceCard: React.FC<PriceCardProps> = ({ name, price, period, features, cta, ctaHref, badge, highlight }) => (
    <div className={`lp-price-card ${highlight ? 'lp-price-card-highlight' : ''}`}>
        {badge && <div className="lp-price-badge">{badge}</div>}
        <h3>{name}</h3>
        <div className="lp-price-line">
            <span className="lp-price-amount">{price}</span>
            <span className="lp-price-period">{period}</span>
        </div>
        <ul className="lp-price-features">
            {features.map((f) => (
                <li key={f}>✓ {f}</li>
            ))}
        </ul>
        <a href={ctaHref} className={`lp-btn ${highlight ? 'lp-btn-primary' : 'lp-btn-secondary'}`}>
            {cta}
        </a>
    </div>
);

// ─── Features ─────────────────────────────────────────────────────────
const Features: React.FC = () => (
    <section id="features" className="lp-section lp-features">
        <h2 className="lp-section-title">The details you'll actually feel</h2>
        <div className="lp-features-grid">
            <Feature emoji="🛡" title="Hallucination guard">
                A "Teacher" agent validates every field against past
                invoices from the same vendor. Amount jumped 10x?
                Currency swapped? VAT doesn't match VIES? Flagged.
            </Feature>
            <Feature emoji="🔗" title="Supplier share links">
                Send a one-click URL to a supplier. They drop a PDF on
                a public landing page, it lands in your dashboard.
                No account needed on their side.
            </Feature>
            <Feature emoji="🌍" title="Multi-language">
                Estonian, Russian, Polish, Lithuanian, German, English.
                Per-language prompt hints halve extraction errors on
                non-English docs.
            </Feature>
            <Feature emoji="📊" title="Bank reconciliation">
                Upload a CSV or XLSX statement. Every transaction is
                matched to an invoice. Partial payments, FX
                conversion, bank fees — all handled.
            </Feature>
            <Feature emoji="🔍" title="Duplicate detection">
                Content-hash + fuzzy-match dedup. Same invoice twice
                from two different inboxes? Caught before it hits
                your books.
            </Feature>
            <Feature emoji="🔒" title="Privacy-first">
                EU hosting, GDPR-compliant, no training on your data,
                full data export, 30-day deletion on request.
            </Feature>
        </div>
    </section>
);

const Feature: React.FC<{ emoji: string; title: string; children: React.ReactNode }> = ({ emoji, title, children }) => (
    <div className="lp-feature">
        <div className="lp-feature-emoji">{emoji}</div>
        <h3>{title}</h3>
        <p>{children}</p>
    </div>
);

// ─── Final CTA ────────────────────────────────────────────────────────
const FinalCTA: React.FC = () => (
    <section className="lp-cta-section">
        <div className="lp-cta-inner">
            <h2>Get your Saturdays back.</h2>
            <p>
                14-day PRO trial. No card required. Unlimited invoices
                on every plan. Cancel anytime from the dashboard.
            </p>
            <a href="/" className="lp-btn lp-btn-primary lp-btn-large">
                Start free →
            </a>
        </div>
    </section>
);

// ─── Footer ───────────────────────────────────────────────────────────
const Footer: React.FC = () => (
    <footer className="lp-footer">
        <div className="lp-footer-inner">
            <div className="lp-footer-brand">
                <span aria-hidden="true">📄</span>
                <span>Invoice-<span className="lp-accent">Tracker</span></span>
            </div>
            <div className="lp-footer-links">
                <a href="/terms">Terms of Service</a>
                <a href="/privacy">Privacy Policy</a>
                <a href="mailto:hello@invoicetracker.app">Contact</a>
                <a href="/">Open app</a>
            </div>
            <div className="lp-footer-note">
                © 2026 Invoice Tracker · Built in Estonia 🇪🇪 ·
                Billing by Lemon Squeezy (MoR)
            </div>
        </div>
    </footer>
);

// ─── Inline CSS ───────────────────────────────────────────────────────
const css = `
.lp-accent { color: #4a9eff; }

.lp-nav {
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding: 1rem 0;
    position: sticky;
    top: 0;
    background: rgba(14, 15, 26, 0.9);
    backdrop-filter: blur(10px);
    z-index: 10;
}
.lp-nav-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.lp-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #e5e7f0;
    text-decoration: none;
    font-size: 1.1rem;
    font-weight: 600;
}
.lp-nav-links { display: flex; gap: 1.5rem; align-items: center; }
.lp-nav-links a {
    color: #b8bccc;
    text-decoration: none;
    font-size: 0.9rem;
}
.lp-nav-links a:hover { color: #e5e7f0; }
.lp-nav-cta {
    background: #4a9eff;
    color: white !important;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
}

.lp-hero {
    padding: 5rem 1.5rem 4rem;
    text-align: center;
}
.lp-hero-inner {
    max-width: 760px;
    margin: 0 auto;
}
.lp-pill {
    display: inline-block;
    background: rgba(74, 158, 255, 0.12);
    color: #4a9eff;
    padding: 0.4rem 0.9rem;
    border-radius: 20px;
    font-size: 0.85rem;
    margin-bottom: 1.5rem;
}
.lp-hero h1 {
    font-size: 3rem;
    line-height: 1.1;
    margin: 0 0 1rem 0;
    font-weight: 700;
    letter-spacing: -0.02em;
}
.lp-subhead {
    font-size: 1.15rem;
    color: #b8bccc;
    line-height: 1.6;
    margin: 0 auto 2rem;
    max-width: 560px;
}
.lp-cta-row {
    display: flex;
    gap: 0.8rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 1rem;
}
.lp-hero-notes {
    color: #6b7084;
    font-size: 0.85rem;
}

.lp-btn {
    display: inline-block;
    padding: 0.85rem 1.6rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
    transition: transform 0.1s;
}
.lp-btn:hover { transform: translateY(-1px); }
.lp-btn-primary {
    background: #4a9eff;
    color: white;
}
.lp-btn-secondary {
    background: transparent;
    color: #e5e7f0;
    border: 1px solid rgba(255,255,255,0.15);
}
.lp-btn-large {
    padding: 1.1rem 2rem;
    font-size: 1.05rem;
}

.lp-section {
    padding: 4rem 1.5rem;
    max-width: 1100px;
    margin: 0 auto;
}
.lp-section-title {
    font-size: 2rem;
    text-align: center;
    margin: 0 0 1rem;
    letter-spacing: -0.01em;
}
.lp-section-sub {
    color: #b8bccc;
    text-align: center;
    max-width: 560px;
    margin: 0 auto 2rem;
    line-height: 1.6;
}

.lp-ps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-top: 2.5rem;
}
.lp-ps-col {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 1.8rem;
}
.lp-ps-problem { background: rgba(255, 107, 107, 0.04); border-color: rgba(255,107,107,0.2); }
.lp-ps-solution { background: rgba(74, 255, 122, 0.04); border-color: rgba(74,255,122,0.2); }
.lp-ps-emoji { font-size: 2rem; margin-bottom: 0.5rem; }
.lp-ps-col h3 { margin: 0 0 0.8rem; }
.lp-ps-col ul { padding-left: 1.2rem; color: #b8bccc; line-height: 1.8; margin: 0; }
.lp-ps-col li { margin: 0.3rem 0; }

.lp-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.2rem;
    margin-top: 2.5rem;
}
.lp-step {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 1.5rem;
    position: relative;
}
.lp-step-num {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(74, 158, 255, 0.15);
    color: #4a9eff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
}
.lp-step-emoji { font-size: 1.8rem; margin-bottom: 0.6rem; }
.lp-step h3 { margin: 0 0 0.5rem; font-size: 1.05rem; }
.lp-step p { margin: 0; color: #b8bccc; line-height: 1.55; font-size: 0.92rem; }

.lp-pricing-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.2rem;
    margin-top: 2rem;
}
.lp-price-card {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 2rem 1.5rem;
    position: relative;
    background: rgba(255,255,255,0.02);
}
.lp-price-card-highlight {
    border-color: #4a9eff;
    background: rgba(74, 158, 255, 0.04);
}
.lp-price-badge {
    position: absolute;
    top: -12px;
    left: 1.5rem;
    background: #4a9eff;
    color: white;
    padding: 0.2rem 0.7rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
}
.lp-price-card h3 { margin: 0 0 0.8rem; font-size: 1.1rem; }
.lp-price-line { margin: 0.5rem 0 1.2rem; }
.lp-price-amount { font-size: 2.2rem; font-weight: 700; }
.lp-price-period { color: #8a8fa3; margin-left: 0.3rem; font-size: 0.9rem; }
.lp-price-features {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
    color: #b8bccc;
    line-height: 1.9;
    font-size: 0.9rem;
}
.lp-price-features li { margin: 0.2rem 0; }
.lp-price-card .lp-btn { display: block; text-align: center; }
.lp-pricing-note {
    text-align: center;
    color: #8a8fa3;
    font-size: 0.85rem;
    margin-top: 1.5rem;
}

.lp-features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.2rem;
    margin-top: 2.5rem;
}
.lp-feature {
    padding: 1.5rem;
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
}
.lp-feature-emoji { font-size: 1.6rem; margin-bottom: 0.6rem; }
.lp-feature h3 { margin: 0 0 0.5rem; font-size: 1rem; }
.lp-feature p { margin: 0; color: #b8bccc; line-height: 1.55; font-size: 0.88rem; }

.lp-cta-section {
    padding: 5rem 1.5rem;
    text-align: center;
    border-top: 1px solid rgba(255,255,255,0.06);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(74, 158, 255, 0.03);
}
.lp-cta-inner { max-width: 560px; margin: 0 auto; }
.lp-cta-section h2 {
    font-size: 2rem;
    margin: 0 0 0.8rem;
    letter-spacing: -0.01em;
}
.lp-cta-section p {
    color: #b8bccc;
    margin: 0 auto 1.8rem;
    line-height: 1.6;
}

.lp-footer {
    padding: 3rem 1.5rem 2rem;
    border-top: 1px solid rgba(255,255,255,0.06);
}
.lp-footer-inner {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
}
.lp-footer-brand {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-weight: 600;
}
.lp-footer-links {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
}
.lp-footer-links a {
    color: #8a8fa3;
    text-decoration: none;
    font-size: 0.85rem;
}
.lp-footer-links a:hover { color: #e5e7f0; }
.lp-footer-note {
    color: #6b7084;
    font-size: 0.8rem;
    text-align: center;
}

@media (max-width: 680px) {
    .lp-hero h1 { font-size: 2.2rem; }
    .lp-nav-links a:not(.lp-nav-cta) { display: none; }
}
`;

export default LandingPage;
