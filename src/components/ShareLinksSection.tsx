/**
 * ShareLinksSection — mini UI for creating + revoking share links
 * (sprint 5 viral loop).
 *
 * Mounted inside the Billing page because share links are a growth
 * feature and that's where users manage their subscription context.
 *
 * Shows:
 *   - "Create new link" form (label + optional companyId)
 *   - List of existing links with copy-to-clipboard + revoke buttons
 *
 * All mutations go through the authenticated /api/share/* endpoints
 * with the user's Firebase ID token. No direct Firestore writes from
 * the client (rules reject them anyway).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authHeaders } from '../data/api';

interface ShareLink {
    token: string;
    ownerUid: string;
    companyId: string | null;
    label: string;
    createdAt: number;
    expiresAt: number;
    maxUploads: number;
    uploadsCount: number;
    revoked: boolean;
}

interface Props {
    selectedCompanyId: string | null;
}

const API_BASE = import.meta.env.VITE_API_BASE || '';

export const ShareLinksSection: React.FC<Props> = ({ selectedCompanyId }) => {
    const { t } = useTranslation();
    const [links, setLinks] = useState<ShareLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [label, setLabel] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const headers = await authHeaders();
            const r = await fetch(`${API_BASE}/api/share/list`, { headers });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Failed to load links');
            setLinks(Array.isArray(data) ? data : []);
        } catch (err: any) {
            setError(err?.message || 'Failed to load links');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    async function createLink() {
        if (creating) return;
        setCreating(true);
        setError(null);
        try {
            const headers = {
                ...(await authHeaders()),
                'Content-Type': 'application/json',
            };
            const r = await fetch(`${API_BASE}/api/share/create`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    companyId: selectedCompanyId,
                    label: label.trim(),
                }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Failed to create link');
            setLabel('');
            await load();
        } catch (err: any) {
            setError(err?.message || 'Failed to create link');
        } finally {
            setCreating(false);
        }
    }

    async function revoke(token: string) {
        if (!window.confirm(t('shareLinks.confirmRevoke', 'Revoke this link?'))) return;
        try {
            const headers = {
                ...(await authHeaders()),
                'Content-Type': 'application/json',
            };
            const r = await fetch(`${API_BASE}/api/share/revoke`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ token }),
            });
            if (!r.ok) {
                const d = await r.json();
                throw new Error(d.error || 'Revoke failed');
            }
            await load();
        } catch (err: any) {
            alert(err?.message || 'Revoke failed');
        }
    }

    function copyUrl(token: string) {
        const url = `${window.location.origin}/share/${token}`;
        navigator.clipboard.writeText(url)
            .then(() => alert(t('shareLinks.copied', 'Copied!')))
            .catch(() => alert(url));
    }

    const active = links.filter((l) => !l.revoked);

    return (
        <div style={{ margin: '2rem 0' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>
                🔗 {t('shareLinks.title', 'Supplier share links')}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 0 }}>
                {t(
                    'shareLinks.description',
                    'Send a link to a supplier and they drop the invoice PDF right into your Invoice Tracker. No account needed for them. Each link is single-company and auto-expires.'
                )}
            </p>

            <div
                style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                    margin: '1rem 0',
                    display: 'flex',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                }}
            >
                <input
                    type="text"
                    placeholder={t('shareLinks.labelPlaceholder', 'Label (e.g. "Acme Supplies")')}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    style={{
                        flex: '1 1 200px',
                        padding: '0.6rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-color)',
                        color: 'var(--text-primary)',
                    }}
                />
                <button
                    onClick={createLink}
                    disabled={creating || !selectedCompanyId}
                    style={{
                        padding: '0.6rem 1.2rem',
                        borderRadius: 'var(--radius-md)',
                        background: selectedCompanyId ? 'var(--accent-color, #4a9eff)' : 'var(--border-color)',
                        color: 'white',
                        border: 'none',
                        cursor: selectedCompanyId ? 'pointer' : 'not-allowed',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                    }}
                >
                    {creating ? t('shareLinks.creating', 'Creating…') : t('shareLinks.create', '+ Generate link')}
                </button>
            </div>

            {!selectedCompanyId && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {t('shareLinks.pickCompany', 'Pick a company on the dashboard first to create a link.')}
                </div>
            )}

            {error && (
                <div style={{ color: 'var(--status-overdue-text, #ff6b6b)', fontSize: '0.9rem', margin: '0.5rem 0' }}>
                    {error}
                </div>
            )}

            {loading ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    {t('loadingData', 'Loading…')}
                </div>
            ) : active.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    {t('shareLinks.none', 'No active share links.')}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {active.map((link) => (
                        <div
                            key={link.token}
                            style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: '0.8rem 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.8rem',
                                flexWrap: 'wrap',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                                    {link.label || t('shareLinks.unlabeled', '(unlabeled)')}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {link.uploadsCount} / {link.maxUploads} {t('shareLinks.uploads', 'uploads')}
                                    {' · '}
                                    {t('shareLinks.expiresAt', 'expires {{date}}', {
                                        date: new Date(link.expiresAt).toLocaleDateString(),
                                    })}
                                </div>
                            </div>
                            <button
                                onClick={() => copyUrl(link.token)}
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'transparent',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                }}
                            >
                                {t('shareLinks.copy', 'Copy')}
                            </button>
                            <button
                                onClick={() => revoke(link.token)}
                                style={{
                                    padding: '0.4rem 0.8rem',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'transparent',
                                    border: '1px solid var(--status-overdue-text, #ff6b6b)',
                                    color: 'var(--status-overdue-text, #ff6b6b)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                }}
                            >
                                {t('shareLinks.revoke', 'Revoke')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ShareLinksSection;
