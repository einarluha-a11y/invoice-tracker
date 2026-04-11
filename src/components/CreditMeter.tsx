/**
 * CreditMeter — compact credit balance badge for the dashboard header.
 *
 * Shows `coins X / Y` where X is remaining credits (monthly + purchased)
 * and Y is the monthly budget. Colour shifts from neutral → warn → danger
 * as the remaining pool shrinks. Click navigates to the Billing page.
 *
 * Hidden when no uid or billing doc is available (e.g. before migration).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BillingDoc } from '../data/billing';
import { creditsAvailable } from '../data/billing';

interface Props {
    billing: BillingDoc | null;
    onClick: () => void;
}

export const CreditMeter: React.FC<Props> = ({ billing, onClick }) => {
    const { t } = useTranslation();

    if (!billing) return null;

    const remaining = creditsAvailable(billing);
    const limit = billing.credits.limit || 0;
    const pct = limit > 0 ? (billing.credits.used / limit) : 0;

    // Danger: less than 10% of monthly budget left AND no purchased pool
    // Warn:   less than 20% left
    // Neutral: everything else
    const state: 'danger' | 'warn' | 'ok' =
        (pct >= 0.9 && billing.credits.purchased === 0) ? 'danger' :
        pct >= 0.8 ? 'warn' : 'ok';

    const borderColor =
        state === 'danger' ? 'var(--status-overdue-text, #ff6b6b)' :
        state === 'warn' ? 'var(--status-pending-text, #f0b90b)' :
        'var(--border-color)';

    const textColor =
        state === 'danger' ? 'var(--status-overdue-text, #ff6b6b)' :
        state === 'warn' ? 'var(--status-pending-text, #f0b90b)' :
        'var(--text-primary)';

    return (
        <button
            onClick={onClick}
            title={t('billing.meter.title', 'Credits — click to manage billing')}
            style={{
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                color: textColor,
                padding: '0.4rem 0.8rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                whiteSpace: 'nowrap',
            }}
        >
            <span aria-hidden="true">🪙</span>
            <span>{remaining}</span>
            {limit > 0 && <span style={{ opacity: 0.5 }}>/ {limit}</span>}
            {billing.trial?.active && (
                <span
                    style={{
                        marginLeft: '0.3rem',
                        fontSize: '0.7rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        background: 'var(--accent-color, #4a9eff)',
                        color: 'white',
                    }}
                >
                    {t('billing.meter.trialBadge', 'TRIAL')}
                </span>
            )}
        </button>
    );
};

export default CreditMeter;
