/**
 * ReferralSection — "Invite friends, get +50 credits" block on the
 * Billing page.
 *
 * Shows:
 *   - Copyable referral URL (landing page with ?ref=<uid>)
 *   - Count of successful referrals + total credits earned
 *   - One-line explainer
 *
 * No signup form, no email capture — just a link the user sends via
 * whatever channel they prefer. Backend grants +50 to purchased credits
 * atomically when each new signup lands.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { buildReferralUrl, getReferralStats, type ReferralStats } from '../data/referrals';

export const ReferralSection: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [stats, setStats] = useState<ReferralStats>({ count: 0, bonusPerReferral: 50, totalEarned: 0 });
    const [copied, setCopied] = useState(false);

    const url = user ? buildReferralUrl(user.uid) : '';

    useEffect(() => {
        if (!user) return;
        getReferralStats().then(setStats).catch(() => {});
    }, [user]);

    async function handleCopy() {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            window.prompt(t('referral.copyPrompt', 'Copy this link'), url);
        }
    }

    if (!user) return null;

    return (
        <div style={{ margin: '2rem 0' }}>
            <h3 style={{ marginBottom: '0.3rem' }}>
                🎁 {t('referral.title', 'Invite friends')}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 0 }}>
                {t(
                    'referral.description',
                    'Earn {{bonus}} credits for every friend who signs up with your link. Credits never expire and stack on top of your monthly allowance.',
                    { bonus: stats.bonusPerReferral }
                )}
            </p>

            <div
                style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                    background: 'var(--surface-color)',
                    margin: '1rem 0',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        gap: '0.6rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <input
                        type="text"
                        value={url}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                        style={{
                            flex: '1 1 280px',
                            padding: '0.6rem 0.8rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-color)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                            fontFamily: 'monospace',
                        }}
                    />
                    <button
                        onClick={handleCopy}
                        style={{
                            padding: '0.6rem 1.2rem',
                            borderRadius: 'var(--radius-md)',
                            background: copied ? 'var(--status-paid-text, #4aff7a)' : 'var(--accent-color, #4a9eff)',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            minWidth: '100px',
                        }}
                    >
                        {copied
                            ? t('referral.copied', '✓ Copied')
                            : t('referral.copy', 'Copy link')}
                    </button>
                </div>

                {stats.count > 0 && (
                    <div
                        style={{
                            marginTop: '1rem',
                            paddingTop: '1rem',
                            borderTop: '1px solid var(--border-color)',
                            display: 'flex',
                            gap: '2rem',
                            flexWrap: 'wrap',
                            fontSize: '0.9rem',
                        }}
                    >
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                {t('referral.friends', 'Friends joined')}
                            </div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 600, marginTop: '0.2rem' }}>
                                {stats.count}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                {t('referral.earned', 'Credits earned')}
                            </div>
                            <div
                                style={{
                                    fontSize: '1.4rem',
                                    fontWeight: 600,
                                    marginTop: '0.2rem',
                                    color: 'var(--status-paid-text, #4aff7a)',
                                }}
                            >
                                +{stats.totalEarned}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReferralSection;
