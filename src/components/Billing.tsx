/**
 * Billing page — subscription, credit usage, and upgrade paths.
 *
 * Reads users/{uid}/billing/state via subscribeToBilling. Shows:
 *   1. Current plan + trial status
 *   2. Credit usage bar (monthly budget)
 *   3. One-time purchased credit pool (if any)
 *   4. Three plan cards with upgrade CTAs
 *   5. Credit pack quick-buy row
 *
 * Checkout URLs come from VITE_LEMON_CHECKOUT_* env vars. Until those are
 * set by Einar, the buttons render greyed out with "checkout not configured".
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import type { BillingDoc, PlanId } from '../data/billing';
import {
    subscribeToBilling,
    creditsAvailable,
    monthlyUsagePct,
    getCheckoutUrl,
} from '../data/billing';
import { ShareLinksSection } from './ShareLinksSection';
import { CreditHistorySection } from './CreditHistorySection';
import { ReferralSection } from './ReferralSection';

interface Props {
    onBack: () => void;
    selectedCompanyId?: string | null;
}

const PLAN_CATALOG: Array<{
    id: PlanId;
    priceMonthly: number;
    priceAnnual: number;
    credits: number;
    features: string[];
    highlight?: boolean;
}> = [
    {
        id: 'free',
        priceMonthly: 0,
        priceAnnual: 0,
        credits: 50,
        features: [
            'billing.features.unlimitedInvoices',
            'billing.features.oneCompany',
            'billing.features.50Credits',
            'billing.features.500MBStorage',
            'billing.features.pdfExport',
        ],
    },
    {
        id: 'pro',
        priceMonthly: 29,
        priceAnnual: 290,
        credits: 500,
        features: [
            'billing.features.unlimitedInvoices',
            'billing.features.5Companies',
            'billing.features.500Credits',
            'billing.features.10GBStorage',
            'billing.features.bankReconciliation',
            'billing.features.emailSupport',
            'billing.features.creditPackPro',
        ],
        highlight: true,
    },
    {
        id: 'business',
        priceMonthly: 79,
        priceAnnual: 790,
        credits: 2000,
        features: [
            'billing.features.unlimitedInvoices',
            'billing.features.unlimitedCompanies',
            'billing.features.2000Credits',
            'billing.features.100GBStorage',
            'billing.features.meritAktiva',
            'billing.features.10TeamSeats',
            'billing.features.dedicatedManager',
            'billing.features.creditPackBusiness',
        ],
    },
];

const CREDIT_PACKS: Array<{ target: 'credits_100' | 'credits_500' | 'credits_1000'; credits: number; price: number }> = [
    { target: 'credits_100', credits: 100, price: 5 },
    { target: 'credits_500', credits: 500, price: 20 },
    { target: 'credits_1000', credits: 1000, price: 35 },
];

export const Billing: React.FC<Props> = ({ onBack, selectedCompanyId = null }) => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [billing, setBilling] = useState<BillingDoc | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        setLoading(true);
        const unsub = subscribeToBilling(user.uid, (b) => {
            setBilling(b);
            setLoading(false);
        });
        return unsub;
    }, [user]);

    const remaining = creditsAvailable(billing);
    const usagePct = monthlyUsagePct(billing);
    const currentPlan = billing?.plan || 'free';

    return (
        <div className="dashboard-container" style={{ maxWidth: '1100px' }}>
            <header className="header">
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <span aria-hidden="true">🪙</span>
                    <span>{t('billing.title', 'Billing & Credits')}</span>
                </h1>
                <button
                    onClick={onBack}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        padding: '0.4rem 0.8rem',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                    }}
                >
                    ← {t('back', 'Back')}
                </button>
            </header>

            {loading ? (
                <div className="table-container empty-state" style={{ margin: '2rem 0' }}>
                    <div className="loader">{t('loadingData', 'Loading...')}</div>
                </div>
            ) : !billing ? (
                <NoBillingNotice />
            ) : (
                <>
                    <CurrentPlanCard billing={billing} remaining={remaining} usagePct={usagePct} />
                    <CreditHistorySection />
                    <PlansGrid currentPlan={currentPlan} uid={user?.uid || ''} />
                    <CreditPacksRow uid={user?.uid || ''} />
                    <ReferralSection />
                    <ShareLinksSection selectedCompanyId={selectedCompanyId} />
                </>
            )}
        </div>
    );
};

const NoBillingNotice: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div
            style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '2rem',
                margin: '2rem 0',
                textAlign: 'center',
                color: 'var(--text-secondary)',
            }}
        >
            <h3>{t('billing.nothingYet.title', 'No billing profile yet')}</h3>
            <p>{t('billing.nothingYet.body', 'Your account has not been migrated to the new billing system yet. All features remain available during the transition — you will be notified when the switch happens.')}</p>
        </div>
    );
};

interface CurrentPlanProps {
    billing: BillingDoc;
    remaining: number;
    usagePct: number;
}

const CurrentPlanCard: React.FC<CurrentPlanProps> = ({ billing, remaining, usagePct }) => {
    const { t } = useTranslation();
    const pct = Math.round(usagePct * 100);
    const trial = billing.trial?.active ?? false;
    const trialEndsAt = billing.trial?.endsAt;

    return (
        <div
            style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.8rem',
                margin: '1.5rem 0',
                background: 'var(--surface-color)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
                    {t(`billing.plan.${billing.plan}`, billing.plan.toUpperCase())}
                </h2>
                {trial && (
                    <span
                        style={{
                            fontSize: '0.75rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            background: 'var(--accent-color, #4a9eff)',
                            color: 'white',
                        }}
                    >
                        {t('billing.meter.trialBadge', 'TRIAL')}
                        {trialEndsAt && ` · ${t('billing.trialEndsAt', 'ends {{date}}', {
                            date: new Date(trialEndsAt).toLocaleDateString(),
                        })}`}
                    </span>
                )}
                {billing.paymentFailed && (
                    <span
                        style={{
                            fontSize: '0.75rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            background: 'var(--status-overdue-bg, #ff6b6b)',
                            color: 'white',
                        }}
                    >
                        {t('billing.paymentFailed', 'Payment failed')}
                    </span>
                )}
            </div>

            <div style={{ marginTop: '1.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                    <span>{t('billing.monthlyUsage', 'Monthly credits')}</span>
                    <span>
                        <strong>{billing.credits.used}</strong> / {billing.credits.limit}
                    </span>
                </div>
                <div
                    style={{
                        height: '8px',
                        background: 'var(--bg-color)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            width: `${Math.min(100, pct)}%`,
                            height: '100%',
                            background:
                                pct >= 90
                                    ? 'var(--status-overdue-text, #ff6b6b)'
                                    : pct >= 80
                                    ? 'var(--status-pending-text, #f0b90b)'
                                    : 'var(--accent-color, #4a9eff)',
                            transition: 'width 0.3s',
                        }}
                    />
                </div>
            </div>

            <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t('billing.remainingTotal', '{{remaining}} credits available now', { remaining })}
                {billing.credits.purchased > 0 && (
                    <>
                        {' — '}
                        {t('billing.purchasedCredits', '{{n}} purchased credits roll over', {
                            n: billing.credits.purchased,
                        })}
                    </>
                )}
            </div>
        </div>
    );
};

interface PlansGridProps {
    currentPlan: PlanId;
    uid: string;
}

const PlansGrid: React.FC<PlansGridProps> = ({ currentPlan, uid }) => {
    const { t } = useTranslation();
    const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

    return (
        <div style={{ margin: '2rem 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>{t('billing.choosePlan', 'Choose a plan')}</h3>
                <div
                    style={{
                        display: 'flex',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                    }}
                >
                    <button
                        onClick={() => setCycle('monthly')}
                        style={cycleBtnStyle(cycle === 'monthly')}
                    >
                        {t('billing.monthly', 'Monthly')}
                    </button>
                    <button
                        onClick={() => setCycle('annual')}
                        style={cycleBtnStyle(cycle === 'annual')}
                    >
                        {t('billing.annual', 'Annual')}
                        <span style={{ fontSize: '0.7rem', marginLeft: '0.3rem', opacity: 0.8 }}>
                            −17%
                        </span>
                    </button>
                </div>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '1rem',
                }}
            >
                {PLAN_CATALOG.map((p) => (
                    <PlanCard
                        key={p.id}
                        plan={p}
                        cycle={cycle}
                        current={currentPlan === p.id}
                        uid={uid}
                    />
                ))}
            </div>
        </div>
    );
};

function cycleBtnStyle(active: boolean): React.CSSProperties {
    return {
        background: active ? 'var(--accent-color, #4a9eff)' : 'transparent',
        color: active ? 'white' : 'var(--text-secondary)',
        border: 'none',
        padding: '0.5rem 1rem',
        cursor: 'pointer',
        fontSize: '0.9rem',
    };
}

interface PlanCardProps {
    plan: (typeof PLAN_CATALOG)[number];
    cycle: 'monthly' | 'annual';
    current: boolean;
    uid: string;
}

const PlanCard: React.FC<PlanCardProps> = ({ plan, cycle, current, uid }) => {
    const { t } = useTranslation();
    const price = cycle === 'monthly' ? plan.priceMonthly : plan.priceAnnual;
    const isFree = plan.id === 'free';

    const checkoutKey =
        plan.id === 'pro'
            ? (cycle === 'monthly' ? 'pro_monthly' : 'pro_annual')
            : plan.id === 'business'
            ? (cycle === 'monthly' ? 'business_monthly' : 'business_annual')
            : null;

    const href = checkoutKey ? getCheckoutUrl(checkoutKey, uid) : null;

    return (
        <div
            style={{
                border: plan.highlight ? '2px solid var(--accent-color, #4a9eff)' : '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                background: current ? 'var(--bg-color)' : 'var(--surface-color)',
                position: 'relative',
            }}
        >
            {plan.highlight && (
                <span
                    style={{
                        position: 'absolute',
                        top: '-10px',
                        left: '1rem',
                        background: 'var(--accent-color, #4a9eff)',
                        color: 'white',
                        fontSize: '0.7rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                    }}
                >
                    {t('billing.mostPopular', 'Most popular')}
                </span>
            )}

            <h4 style={{ margin: 0, fontSize: '1.1rem' }}>
                {t(`billing.plan.${plan.id}`, plan.id.toUpperCase())}
            </h4>

            <div style={{ margin: '0.8rem 0' }}>
                <span style={{ fontSize: '2rem', fontWeight: 700 }}>€{price}</span>
                {!isFree && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        /{cycle === 'monthly' ? t('billing.perMonth', 'month') : t('billing.perYear', 'year')}
                    </span>
                )}
            </div>

            <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', fontSize: '0.9rem' }}>
                {plan.features.map((fKey) => (
                    <li key={fKey} style={{ padding: '0.3rem 0', color: 'var(--text-secondary)' }}>
                        ✓ {t(fKey, fKey)}
                    </li>
                ))}
            </ul>

            {current ? (
                <div
                    style={{
                        textAlign: 'center',
                        padding: '0.7rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                        border: '1px dashed var(--border-color)',
                    }}
                >
                    {t('billing.yourCurrentPlan', 'Your current plan')}
                </div>
            ) : isFree ? (
                <div
                    style={{
                        textAlign: 'center',
                        padding: '0.7rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                    }}
                >
                    {t('billing.alwaysFree', 'Always free')}
                </div>
            ) : (
                <a
                    href={href || '#'}
                    onClick={(e) => { if (!href) e.preventDefault(); }}
                    style={{
                        display: 'block',
                        textAlign: 'center',
                        padding: '0.7rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        background: href ? 'var(--accent-color, #4a9eff)' : 'var(--bg-color)',
                        color: href ? 'white' : 'var(--text-secondary)',
                        cursor: href ? 'pointer' : 'not-allowed',
                        opacity: href ? 1 : 0.6,
                    }}
                >
                    {href ? t('billing.upgrade', 'Upgrade') : t('billing.modal.checkoutNotReady', 'Checkout not configured')}
                </a>
            )}
        </div>
    );
};

interface CreditPacksRowProps {
    uid: string;
}

const CreditPacksRow: React.FC<CreditPacksRowProps> = ({ uid }) => {
    const { t } = useTranslation();
    return (
        <div style={{ margin: '2rem 0' }}>
            <h3>{t('billing.creditPacks', 'One-time credit packs')}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {t('billing.creditPacksDesc', 'Top up anytime. Purchased credits never expire and stack on top of your monthly allowance.')}
            </p>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                }}
            >
                {CREDIT_PACKS.map((pack) => {
                    const href = getCheckoutUrl(pack.target, uid);
                    return (
                        <a
                            key={pack.target}
                            href={href || '#'}
                            onClick={(e) => { if (!href) e.preventDefault(); }}
                            style={{
                                display: 'block',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: '1rem',
                                textAlign: 'center',
                                textDecoration: 'none',
                                color: 'var(--text-primary)',
                                cursor: href ? 'pointer' : 'not-allowed',
                                opacity: href ? 1 : 0.6,
                            }}
                        >
                            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                                {pack.credits} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>🪙</span>
                            </div>
                            <div style={{ fontSize: '1.1rem', margin: '0.4rem 0' }}>€{pack.price}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {href
                                    ? t('billing.buyNow', 'Buy now')
                                    : t('billing.modal.checkoutNotReady', 'Checkout not configured')}
                            </div>
                        </a>
                    );
                })}
            </div>
        </div>
    );
};

export default Billing;
