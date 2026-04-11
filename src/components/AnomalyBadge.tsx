/**
 * AnomalyBadge — small warning badge that appears next to an invoice
 * row when the anomaly_detector (core/anomaly_detector.cjs) flagged
 * something suspicious during extraction.
 *
 * Score thresholds (mirror detector output):
 *   0.0 – 0.4  → nothing (badge hidden)
 *   0.4 – 0.7  → "Unusual" (amber)
 *   0.7 – 1.0  → "Anomaly" (red)
 *
 * On hover shows the list of reasons the detector produced, e.g.
 * "Amount 10x vendor average", "Round-large amount", "Due date
 * before invoice date", "Duplicate within 7 days".
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Invoice } from '../data/types';

interface Props {
    invoice: Invoice;
}

export const AnomalyBadge: React.FC<Props> = ({ invoice }) => {
    const { t } = useTranslation();
    const score = invoice.anomalyScore ?? 0;
    const reasons = invoice.anomalyReasons || [];

    if (score < 0.4 && reasons.length === 0) return null;

    const severity: 'warn' | 'danger' = score >= 0.7 ? 'danger' : 'warn';
    const label =
        severity === 'danger'
            ? t('anomaly.anomaly', 'Anomaly')
            : t('anomaly.unusual', 'Unusual');
    const colour = severity === 'danger' ? '#ff6b6b' : '#f0b90b';

    const tooltip =
        reasons.length > 0
            ? `${label} (${Math.round(score * 100)}%):\n• ${reasons.join('\n• ')}`
            : `${label} (${Math.round(score * 100)}%)`;

    return (
        <span
            title={tooltip}
            aria-label={tooltip}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '4px',
                background: `${colour}22`,
                color: colour,
                border: `1px solid ${colour}44`,
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
                cursor: 'help',
                whiteSpace: 'nowrap',
            }}
        >
            <span aria-hidden="true">{severity === 'danger' ? '⚠' : '!'}</span>
            <span>{label}</span>
        </span>
    );
};

export default AnomalyBadge;
