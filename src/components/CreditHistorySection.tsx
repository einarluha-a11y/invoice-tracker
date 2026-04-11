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
                    style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1.2fr 2fr 0.6fr 0.8fr 0.8fr',
                            gap: '0.5rem',
                            padding: '0.6rem 1rem',
                            background: 'var(--bg-color)',
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                        }}
                    >
                        <div>{t('billing.usage.when', 'When')}</div>
                        <div>{t('billing.usage.action', 'Action')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.units', 'Units')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.cost', 'Cost')}</div>
                        <div style={{ textAlign: 'right' }}>{t('billing.usage.leftAfter', 'After')}</div>
                    </div>
                    {events.map((e) => (
                        <div
                            key={e.id}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1.2fr 2fr 0.6fr 0.8fr 0.8fr',
                                gap: '0.5rem',
                                padding: '0.6rem 1rem',
                                borderTop: '1px solid var(--border-color)',
                                fontSize: '0.85rem',
                                alignItems: 'center',
                            }}
                        >
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                {formatAt(e.at, i18n.language)}
                            </div>
                            <div>
                                <span style={{ marginRight: '0.4rem' }}>{ACTION_EMOJI[e.action] || '•'}</span>
                                {t(ACTION_LABEL_KEY[e.action] || e.action, humanizeAction(e.action))}
                            </div>
                            <div style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                {e.units}
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                −{e.cost}
                            </div>
                            <div style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                {e.remaining}
                            </div>
                        </div>
                    ))}
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
