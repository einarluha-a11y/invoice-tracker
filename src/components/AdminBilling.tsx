/**
 * AdminBilling — master-only overview of every user's billing state.
 *
 * Gives operators a single screen to see:
 *   - Each user, their plan, credit usage bar
 *   - Payment-failed flags
 *   - Trial status + days left
 *   - Aggregate stats: active subscribers, MRR proxy, total credits
 *     burnt this month
 *
 * Only mounted when isMaster is true — otherwise the Billing page
 * renders normally. The collectionGroup('billing') query requires
 * a Firestore collectionGroup index (added to firestore.indexes.json).
 *
 * Writes NOTHING. Pure read-only. If an operator needs to fix a
 * broken plan state, they do it via Firestore admin UI or a
 * targeted Admin SDK script — never from this page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectionGroup, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import type { BillingDoc, PlanId } from '../data/billing';

interface Props {
    onBack: () => void;
}

interface Row extends BillingDoc {
    docPath: string;
}

const PLAN_PRICE_MONTHLY: Record<PlanId, number> = {
    free: 0,
    pro: 29,
    business: 79,
};

export const AdminBilling: React.FC<Props> = ({ onBack }) => {
    const { t } = useTranslation();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!db) return;
        setLoading(true);
        const q = query(
            collectionGroup(db, 'billing'),
            orderBy('updatedAt', 'desc')
        );
        const unsub = onSnapshot(
            q,
            (snap) => {
                const list: Row[] = [];
                snap.forEach((doc) => {
                    const d = doc.data() as BillingDoc;
                    // collectionGroup returns every billing/state doc —
                    // we only care about the state doc itself, not any
                    // future sibling docs.
                    if (doc.id !== 'state') return;
                    list.push({ ...d, docPath: doc.ref.path });
                });
                setRows(list);
                setLoading(false);
            },
            (err) => {
                console.error('[AdminBilling] query failed:', err);
                setError(err.message);
                setLoading(false);
            }
        );
        return unsub;
    }, []);

    const stats = useMemo(() => {
        let totalUsers = 0;
        let freeUsers = 0;
        let proUsers = 0;
        let businessUsers = 0;
        let trialActive = 0;
        let paymentFailed = 0;
        let mrr = 0;
        let creditsBurnt = 0;
        for (const r of rows) {
            totalUsers++;
            if (r.plan === 'free') freeUsers++;
            else if (r.plan === 'pro') proUsers++;
            else if (r.plan === 'business') businessUsers++;
            if (r.trial?.active) trialActive++;
            if (r.paymentFailed) paymentFailed++;
            if (r.plan !== 'free' && !r.trial?.active) {
                mrr += PLAN_PRICE_MONTHLY[r.plan];
            }
            creditsBurnt += Number(r.credits?.used) || 0;
        }
        return {
            totalUsers, freeUsers, proUsers, businessUsers,
            trialActive, paymentFailed, mrr, creditsBurnt,
        };
    }, [rows]);

    return (
        <div className="dashboard-container" style={{ maxWidth: '1200px' }}>
            <header className="header">
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <span aria-hidden="true">📊</span>
                    <span>{t('admin.billing.title', 'Billing — admin view')}</span>
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

            <StatsGrid stats={stats} />

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
                    {t('admin.billing.error', 'Could not load billing data')}: {error}
                </div>
            )}

            <h3 style={{ marginTop: '2rem', marginBottom: '0.5rem' }}>
                {t('admin.billing.users', 'Users')} ({rows.length})
            </h3>

            {loading ? (
                <div style={{ color: 'var(--text-secondary)' }}>
                    {t('loadingData', 'Loading…')}
                </div>
            ) : rows.length === 0 ? (
                <div
                    style={{
                        padding: '1.5rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)',
                        textAlign: 'center',
                    }}
                >
                    {t('admin.billing.empty', 'No billing docs yet. Run the migration script.')}
                </div>
            ) : (
                <UsersTable rows={rows} />
            )}
        </div>
    );
};

interface StatsProps {
    stats: {
        totalUsers: number;
        freeUsers: number;
        proUsers: number;
        businessUsers: number;
        trialActive: number;
        paymentFailed: number;
        mrr: number;
        creditsBurnt: number;
    };
}

const StatsGrid: React.FC<StatsProps> = ({ stats }) => {
    const { t } = useTranslation();
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '1rem',
                marginTop: '1.5rem',
            }}
        >
            <StatCard label={t('admin.billing.statUsers', 'Users')} value={stats.totalUsers} />
            <StatCard label={t('admin.billing.statFree', 'FREE')} value={stats.freeUsers} />
            <StatCard label={t('admin.billing.statPro', 'PRO')} value={stats.proUsers} />
            <StatCard label={t('admin.billing.statBusiness', 'BUSINESS')} value={stats.businessUsers} />
            <StatCard label={t('admin.billing.statTrial', 'On trial')} value={stats.trialActive} />
            <StatCard
                label={t('admin.billing.statFailed', 'Payment failed')}
                value={stats.paymentFailed}
                highlight={stats.paymentFailed > 0 ? 'danger' : undefined}
            />
            <StatCard
                label={t('admin.billing.statMRR', 'MRR proxy')}
                value={`€${stats.mrr}`}
                highlight="accent"
            />
            <StatCard
                label={t('admin.billing.statBurnt', 'Credits burnt')}
                value={stats.creditsBurnt}
            />
        </div>
    );
};

const StatCard: React.FC<{
    label: string;
    value: number | string;
    highlight?: 'accent' | 'danger';
}> = ({ label, value, highlight }) => (
    <div
        style={{
            border: `1px solid ${
                highlight === 'danger'
                    ? 'var(--status-overdue-text, #ff6b6b)'
                    : highlight === 'accent'
                    ? 'var(--accent-color, #4a9eff)'
                    : 'var(--border-color)'
            }`,
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            background: 'var(--surface-color)',
        }}
    >
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            {label}
        </div>
        <div style={{ fontSize: '1.6rem', fontWeight: 600, marginTop: '0.2rem' }}>
            {value}
        </div>
    </div>
);

const UsersTable: React.FC<{ rows: Row[] }> = ({ rows }) => {
    const { t, i18n } = useTranslation();
    return (
        <div
            style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                overflow: 'auto',
            }}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 0.8fr 0.8fr 2.5fr 1fr 1fr',
                    gap: '0.5rem',
                    padding: '0.7rem 1rem',
                    background: 'var(--bg-color)',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                }}
            >
                <div>{t('admin.billing.col.user', 'User')}</div>
                <div>{t('admin.billing.col.plan', 'Plan')}</div>
                <div>{t('admin.billing.col.cycle', 'Cycle')}</div>
                <div>{t('admin.billing.col.usage', 'Usage (monthly)')}</div>
                <div style={{ textAlign: 'right' }}>{t('admin.billing.col.purchased', 'Purchased')}</div>
                <div>{t('admin.billing.col.flags', 'Flags')}</div>
            </div>
            {rows.map((r) => {
                const used = r.credits?.used || 0;
                const limit = r.credits?.limit || 0;
                const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                return (
                    <div
                        key={r.docPath}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 0.8fr 0.8fr 2.5fr 1fr 1fr',
                            gap: '0.5rem',
                            padding: '0.7rem 1rem',
                            borderTop: '1px solid var(--border-color)',
                            fontSize: '0.85rem',
                            alignItems: 'center',
                        }}
                    >
                        <div>
                            <div style={{ fontWeight: 500 }}>{r.uid.slice(0, 12)}…</div>
                            {(r as any).email && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {(r as any).email}
                                </div>
                            )}
                        </div>
                        <div>
                            <PlanBadge plan={r.plan} />
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            {r.billingCycle}
                        </div>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                                <span>{used} / {limit}</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{pct}%</span>
                            </div>
                            <div
                                style={{
                                    height: '6px',
                                    background: 'var(--bg-color)',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                }}
                            >
                                <div
                                    style={{
                                        width: `${pct}%`,
                                        height: '100%',
                                        background: pct >= 90
                                            ? 'var(--status-overdue-text, #ff6b6b)'
                                            : pct >= 80
                                            ? 'var(--status-pending-text, #f0b90b)'
                                            : 'var(--accent-color, #4a9eff)',
                                    }}
                                />
                            </div>
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                            {r.credits?.purchased || 0}
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {r.trial?.active && <Tag kind="accent">TRIAL</Tag>}
                            {r.paymentFailed && <Tag kind="danger">FAILED</Tag>}
                            {(r as any).migration?.reason === 'existing_user_grandfather' && <Tag kind="neutral">GF</Tag>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const PlanBadge: React.FC<{ plan: PlanId }> = ({ plan }) => {
    const colour = plan === 'business' ? '#a970ff' : plan === 'pro' ? '#4a9eff' : '#8a8fa3';
    return (
        <span
            style={{
                padding: '0.15rem 0.5rem',
                borderRadius: '3px',
                background: `${colour}22`,
                color: colour,
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
            }}
        >
            {plan}
        </span>
    );
};

const Tag: React.FC<{ kind: 'accent' | 'danger' | 'neutral'; children: React.ReactNode }> = ({ kind, children }) => {
    const colour =
        kind === 'accent' ? '#4a9eff' :
        kind === 'danger' ? '#ff6b6b' : '#8a8fa3';
    return (
        <span
            style={{
                padding: '0.1rem 0.35rem',
                borderRadius: '3px',
                background: `${colour}22`,
                color: colour,
                fontSize: '0.65rem',
                fontWeight: 600,
            }}
        >
            {children}
        </span>
    );
};

export default AdminBilling;
