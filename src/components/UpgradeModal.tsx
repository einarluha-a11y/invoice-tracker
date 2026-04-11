/**
 * UpgradeModal — appears when the user crosses a credit threshold.
 *
 * Two states:
 *   - soft (80%+ used)    → "Credits running low, consider upgrading"
 *   - hard (100% used AND no purchased credits) → "AI features paused,
 *     upgrade or top up to continue"
 *
 * Shows the current plan and three upgrade paths: next tier, credit
 * pack top-up, annual discount. Each button links to a Lemon Squeezy
 * checkout URL with the user's uid in custom_data so the webhook can
 * activate the right plan on success.
 *
 * Can be dismissed by clicking outside or the ✕ button. Dismissal is
 * session-local — the modal comes back next time the condition is true.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BillingDoc } from '../data/billing';
import { creditsAvailable, getCheckoutUrl } from '../data/billing';

interface Props {
    billing: BillingDoc;
    onClose: () => void;
    onNavigateToBilling: () => void;
}

export const UpgradeModal: React.FC<Props> = ({ billing, onClose, onNavigateToBilling }) => {
    const { t } = useTranslation();
    const remaining = creditsAvailable(billing);
    const pct = billing.credits.limit > 0 ? billing.credits.used / billing.credits.limit : 0;
    const isHardBlock = remaining === 0;

    const proMonthly = getCheckoutUrl('pro_monthly', billing.uid);
    const proAnnual = getCheckoutUrl('pro_annual', billing.uid);
    const pack500 = getCheckoutUrl('credits_500', billing.uid);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '1rem',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--surface-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '2rem',
                    maxWidth: '500px',
                    width: '100%',
                    color: 'var(--text-primary)',
                    position: 'relative',
                }}
            >
                <button
                    onClick={onClose}
                    aria-label={t('close', 'Close')}
                    style={{
                        position: 'absolute',
                        top: '0.8rem',
                        right: '0.8rem',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        width: '2rem',
                        height: '2rem',
                    }}
                >
                    ✕
                </button>

                <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                    {isHardBlock
                        ? t('billing.modal.hardTitle', 'AI features paused')
                        : t('billing.modal.softTitle', 'Credits running low')}
                </h2>

                <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
                    {isHardBlock
                        ? t(
                            'billing.modal.hardBody',
                            'You have used all your monthly AI credits. Manual invoice entry still works, but automatic extraction, bank reconciliation and duplicate detection are paused until you upgrade or buy a credit pack.'
                        )
                        : t(
                            'billing.modal.softBody',
                            "You have used {{pct}}% of your monthly credits. Consider upgrading to keep AI automation running smoothly.",
                            { pct: Math.round(pct * 100) }
                        )}
                </p>

                <div
                    style={{
                        background: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: '1rem',
                        margin: '1.2rem 0',
                    }}
                >
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {t('billing.modal.currentPlan', 'Current plan')}
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 600, marginTop: '0.2rem' }}>
                        {billing.plan.toUpperCase()}
                        {billing.trial?.active && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'var(--accent-color, #4a9eff)', color: 'white', verticalAlign: 'middle' }}>
                                {t('billing.meter.trialBadge', 'TRIAL')}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                        {t('billing.modal.remaining', '{{remaining}} / {{limit}} credits remaining', {
                            remaining,
                            limit: billing.credits.limit,
                        })}
                        {billing.credits.purchased > 0 && (
                            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>
                                (+{billing.credits.purchased} {t('billing.modal.purchased', 'purchased')})
                            </span>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <UpgradeButton
                        primary
                        label={t('billing.modal.upgradeToPro', 'Upgrade to PRO — €29/month')}
                        href={proMonthly}
                    />
                    <UpgradeButton
                        label={t('billing.modal.upgradeToProAnnual', 'PRO Annual — €290/year (save €58)')}
                        href={proAnnual}
                    />
                    <UpgradeButton
                        label={t('billing.modal.buyCreditPack', 'Buy 500 credits — €20 one-time')}
                        href={pack500}
                    />
                    <button
                        onClick={onNavigateToBilling}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)',
                            padding: '0.7rem 1rem',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            marginTop: '0.3rem',
                        }}
                    >
                        {t('billing.modal.viewAllPlans', 'View all plans →')}
                    </button>
                </div>
            </div>
        </div>
    );
};

interface ButtonProps {
    label: string;
    href: string | null;
    primary?: boolean;
}

const UpgradeButton: React.FC<ButtonProps> = ({ label, href, primary }) => {
    const { t } = useTranslation();
    const disabled = !href;
    return (
        <a
            href={href || '#'}
            onClick={(e) => { if (disabled) e.preventDefault(); }}
            style={{
                display: 'block',
                textAlign: 'center',
                padding: '0.7rem 1rem',
                borderRadius: 'var(--radius-md)',
                textDecoration: 'none',
                fontSize: '0.95rem',
                fontWeight: primary ? 600 : 400,
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: primary ? 'var(--accent-color, #4a9eff)' : 'transparent',
                color: primary ? 'white' : 'var(--text-primary)',
                border: primary ? 'none' : '1px solid var(--border-color)',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            {disabled ? `${label} — ${t('billing.modal.checkoutNotReady', 'checkout not configured')}` : label}
        </a>
    );
};

export default UpgradeModal;
