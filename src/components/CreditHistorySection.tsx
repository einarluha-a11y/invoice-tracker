/**
 * CreditHistorySection — usage chart + table of last 50 spend events.
 * Mounted inside Billing.tsx below the plan cards.
 *
 * Data flow:
 *   - subscribeToUserSpends(uid, 50, ...) from data/billing_events.ts
 *   - bucketByDay(events, 30) → UsageChart
 *   - Raw events → rendered as a table
 *
 * All read-side only. No mutations from this component.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import {
    subscribeToUserSpends,
    bucketByDay,
    type BillingSpendEvent,
    type BillingAction,
} from '../data/billing_events';
import { UsageChart } from './UsageChart';

const ACTION_LABEL_KEY: Record<BillingAction, string> = {
    ai_extraction: 'billing.action.ai_extraction',
    bank_reconciliation: 'billing.action.bank_reconciliation',
    ai_teacher_rule: 'billing.action.ai_teacher_rule',
    smart_duplicate_check: 'billing.action.smart_duplicate_check',
    auto_categorization: 'billing.action.auto_categorization',
};

const ACTION_EMOJI: Record<BillingAction, string> = {
    ai_extraction: '📄',
    bank_reconciliation: '💶',
    ai_teacher_rule: '🎓',
    smart_duplicate_check: '🔍',
    auto_categorization: '🏷️',
};

export const CreditHistorySection: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const [events, setEvents] = useState<BillingSpendEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        setLoading(true);
        const unsub = subscribeToUserSpends(
            user.uid,
            50,
            (list) => {
                setEvents(list);
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
            }
        );
        return unsub;
    }, [user]);

    const buckets = useMemo(() => bucketByDay(events, 30), [events]);

    return (
        <div style={{ margin: '2rem 0' }}>
            <h3 style={{ marginBottom: '0.3rem' }}>
                📊 {t('billing.usage.title', 'Usage history')}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 0 }}>
                {t(
                    'billing.usage.description',
                    'Live credit consumption from AI extractions, bank reconciliation, and other billable actions.'
                )}
            </p>

            {error && (
                <div
                    style={{
                        padding: '1rem',
                        border: '1px solid var(--status-overdue-text, #ff6b6b)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--status-overdue-text, #ff6b6b)',
                        fontSize: '0.9rem',
                        margin: '1rem 0',
                    }}
                >
                    {t('billing.usage.error', 'Could not load usage history')}: {error}
                </div>
            )}

            <div
                style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '1.2rem',
                    background: 'var(--surface-color)',
                    margin: '1rem 0',
                }}
            >
                <UsageChart buckets={buckets} />
            </div>

            <h4 style={{ marginTop: '1.5rem', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
                {t('billing.usage.recentSpends', 'Recent spends')}
            </h4>

            {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    {t('loadingData', 'Loading…')}
                </div>
            ) : events.length === 0 ? (
                <div
                    style={{
                        padding: '1rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        textAlign: 'center',
                    }}
                >
                    {t('billing.usage.noSpends', 'No credit spends yet. When you process invoices or reconcile bank statements, each billable action will show up here.')}
                </div>
            ) : (
                <div
                    className="credit-history-table"
                    style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                    }}
                >
                    {/* Header — hidden on mobile so narrow screens don't
                         cram 5 columns into 320px. Cards on mobile,
                         table on desktop (controlled by the <style> tag
                         below with media queries). */}
                    <div className="credit-history-header">
                        <div>{t('billing.usage.when', 'When')}</div>
                        <div>{t('billing.usage.action', 'Action')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.units', 'Units')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.cost', 'Cost')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.leftAfter', 'After')}</div>
                    </div>
                    {events.map((e) => (
                        <div key={e.id} className="credit-history-row">
                            <div className="col-when" data-label={t('billing.usage.when', 'When')}>
                                {formatAt(e.at, i18n.language)}
                            </div>
                            <div className="col-action" data-label={t('billing.usage.action', 'Action')}>
                                <span style={{ marginRight: '0.4rem' }}>{ACTION_EMOJI[e.action] || '•'}</span>
                                {t(ACTION_LABEL_KEY[e.action] || e.action, humanizeAction(e.action))}
                            </div>
                            <div className="col-units" data-label={t('billing.usage.units', 'Units')}>
                                {e.units}
                            </div>
                            <div className="col-cost" data-label={t('billing.usage.cost', 'Cost')}>
                                −{e.cost}
                            </div>
                            <div className="col-after" data-label={t('billing.usage.leftAfter', 'After')}>
                                {e.remaining}
                            </div>
                        </div>
                    ))}
                    <style>{`
                        .credit-history-header {
                            display: grid;
                            grid-template-columns: 1.2fr 2fr 0.6fr 0.8fr 0.8fr;
                            gap: 0.5rem;
                            padding: 0.6rem 1rem;
                            background: var(--bg-color);
                            font-size: 0.75rem;
                            color: var(--text-secondary);
                            text-transform: uppercase;
                            letter-spacing: 0.05em;
                        }
                        .credit-history-row {
                            display: grid;
                            grid-template-columns: 1.2fr 2fr 0.6fr 0.8fr 0.8fr;
                            gap: 0.5rem;
                            padding: 0.6rem 1rem;
                            border-top: 1px solid var(--border-color);
                            font-size: 0.85rem;
                            align-items: center;
                        }
                        .credit-history-row .col-when { color: var(--text-secondary); font-size: 0.8rem; }
                        .credit-history-row .col-units,
                        .credit-history-row .col-cost,
                        .credit-history-row .col-after { text-align: right; }
                        .credit-history-row .col-cost { font-family: monospace; }
                        .credit-history-row .col-after { color: var(--text-secondary); font-family: monospace; }

                        @media (max-width: 680px) {
                            .credit-history-header { display: none; }
                            .credit-history-row {
                                display: block;
                                padding: 0.8rem 1rem;
                            }
                            .credit-history-row > div {
                                display: flex;
                                justify-content: space-between;
                                padding: 0.15rem 0;
                                text-align: left !important;
                                font-size: 0.85rem;
                            }
                            .credit-history-row > div::before {
                                content: attr(data-label);
                                color: var(--text-secondary);
                                font-size: 0.7rem;
                                text-transform: uppercase;
                                letter-spacing: 0.04em;
                                flex: 0 0 auto;
                                margin-right: 0.8rem;
                            }
                            .credit-history-row .col-action {
                                font-weight: 500;
                            }
                        }
                    `}</style>
                </div>
            )}
        </div>
    );
};

function formatAt(ms: number, locale: string): string {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleString(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function humanizeAction(a: string): string {
    return a.replace(/_/g, ' ');
}

export default CreditHistorySection;
