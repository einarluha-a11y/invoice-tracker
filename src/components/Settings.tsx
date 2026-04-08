import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompanies } from '../hooks/useCompanies';
import { doc, setDoc, onSnapshot, serverTimestamp, collection, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { authHeaders } from '../data/api';
import { useAuth } from '../context/AuthContext';

interface SettingsProps {
    onBack: () => void;
}

export function Settings({ onBack }: SettingsProps) {
    const { t } = useTranslation();
    const { userRole, currentAccountId } = useAuth();
    const { companies, companiesLoading, companiesError, addCompany, updateCompany, deleteCompany } = useCompanies();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        emailAddress: '',
        imapHost: '',
        imapUser: '',
        imapPassword: '',
        imapPort: 993 as number | ''
    });

    // ── Roles ────────────────────────────────────────────────────────────────
    const currentRole = userRole || 'user';
    const [users, setUsers] = useState<{ uid: string; email: string; role: string }[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [roleMsg, setRoleMsg] = useState<string>('');

    // Master: load via API; Admin: load from Firestore accounts/{accountId}/users
    const loadUsers = async () => {
        setUsersLoading(true);
        try {
            if (currentRole === 'master') {
                const apiBase = (import.meta as any).env?.VITE_API_URL || '';
                const r = await fetch(`${apiBase}/api/users/list`, { headers: await authHeaders() });
                if (r.ok) setUsers(await r.json());
            } else if (currentRole === 'admin' && currentAccountId && db) {
                const snap = await getDocs(collection(db, 'accounts', currentAccountId, 'users'));
                setUsers(snap.docs.map(d => ({
                    uid: d.id,
                    email: (d.data().email as string) || d.id,
                    role: (d.data().role as string) || 'user',
                })));
            }
        } catch { /* ignore */ } finally { setUsersLoading(false); }
    };

    const handleSetRole = async (uid: string, role: string) => {
        try {
            if (currentRole === 'master') {
                const apiBase = (import.meta as any).env?.VITE_API_URL || '';
                const r = await fetch(`${apiBase}/api/users/roles`, {
                    method: 'POST',
                    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid, role })
                });
                const data = await r.json();
                if (data.ok) {
                    setRoleMsg(`${t('settingsPage.roleUpdated')}: ${uid}`);
                    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
                } else {
                    setRoleMsg(data.error || t('settingsPage.errorPrefix'));
                }
            } else if (currentRole === 'admin' && currentAccountId && db) {
                await updateDoc(doc(db, 'accounts', currentAccountId, 'users', uid), { role });
                setRoleMsg(`${t('settingsPage.roleUpdated')}: ${uid}`);
                setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
            }
        } catch (e: any) { setRoleMsg(e.message); }
    };

    // ── Global AI Rules ─────────────────────────────────────────────────────
    const [globalRules, setGlobalRules] = useState<string>('');
    const [rulesLoading, setRulesLoading] = useState(true);
    const [showRules, setShowRules] = useState(false);
    const [newRuleText, setNewRuleText] = useState<string>('');
    const [editingRuleIdx, setEditingRuleIdx] = useState<number | null>(null);
    const [editingRuleText, setEditingRuleText] = useState<string>('');

    useEffect(() => {
        if (!db) return;
        const rulesRef = doc(db, 'config', 'global_ai_rules');
        return onSnapshot(rulesRef, (snap) => {
            setGlobalRules(snap.exists() ? (snap.data().customAiRules || '') : '');
            setRulesLoading(false);
        });
    }, []);

    const rulesList = globalRules.split('\n').filter(r => r.trim() !== '');

    const invalidateBackendCache = async () => {
        try {
            const apiBase = (import.meta as any).env?.VITE_API_URL || '';
            await fetch(`${apiBase}/api/invalidate-cache`, { method: 'POST', headers: await authHeaders() });
        } catch { /* бэкенд может быть недоступен — не блокируем UI */ }
    };

    const handleAddRule = async () => {
        const trimmed = newRuleText.trim();
        if (!trimmed || !db) return;
        const updated = globalRules ? globalRules + '\n' + trimmed : trimmed;
        try {
            const rulesRef = doc(db, 'config', 'global_ai_rules');
            await setDoc(rulesRef, {
                customAiRules: updated,
                updatedAt: serverTimestamp(),
                updatedBy: 'manual'
            }, { merge: true });
            await invalidateBackendCache();
            setNewRuleText('');
        } catch (error) {
            console.error("Failed to add rule", error);
            alert(t('settingsPage.errorPrefix') + " " + error);
        }
    };

    const handleDeleteSingleRule = async (ruleIndex: number) => {
        if (!db) return;
        const rulesArray = globalRules.split('\n').filter(r => r.trim() !== '');
        rulesArray.splice(ruleIndex, 1);
        try {
            const rulesRef = doc(db, 'config', 'global_ai_rules');
            await setDoc(rulesRef, {
                customAiRules: rulesArray.join('\n'),
                updatedAt: serverTimestamp(),
                updatedBy: 'manual'
            }, { merge: true });
            await invalidateBackendCache();
        } catch (error) {
            console.error("Failed to update rules", error);
            alert(t('settingsPage.deleteRuleError'));
        }
    };

    const handleStartEditRule = (ruleIndex: number) => {
        setEditingRuleIdx(ruleIndex);
        setEditingRuleText(rulesList[ruleIndex] || '');
    };

    const handleCancelEditRule = () => {
        setEditingRuleIdx(null);
        setEditingRuleText('');
    };

    const handleSaveEditedRule = async () => {
        if (editingRuleIdx === null || !db) return;
        const trimmed = editingRuleText.trim();
        if (!trimmed) return;
        const rulesArray = globalRules.split('\n').filter(r => r.trim() !== '');
        rulesArray[editingRuleIdx] = trimmed;
        try {
            const rulesRef = doc(db, 'config', 'global_ai_rules');
            await setDoc(rulesRef, {
                customAiRules: rulesArray.join('\n'),
                updatedAt: serverTimestamp(),
                updatedBy: 'manual'
            }, { merge: true });
            await invalidateBackendCache();
            setEditingRuleIdx(null);
            setEditingRuleText('');
        } catch (error) {
            console.error("Failed to update rule", error);
            alert(t('settingsPage.errorPrefix') + " " + error);
        }
    };

    const handleClearAllRules = async () => {
        if (!db) return;
        if (window.confirm(t('settingsPage.confirmClearRules'))) {
            try {
                const rulesRef = doc(db, 'config', 'global_ai_rules');
                await setDoc(rulesRef, {
                    customAiRules: '',
                    updatedAt: serverTimestamp(),
                    updatedBy: 'manual'
                }, { merge: true });
                await invalidateBackendCache();
                setShowRules(false);
            } catch (error) {
                console.error("Failed to clear rules", error);
            }
        }
    };

    // ── Company CRUD ────────────────────────────────────────────────────────
    const handleEdit = (company: any) => {
        setEditingId(company.id);
        setFormData({
            name: company.name,
            emailAddress: company.emailAddress || '',
            imapHost: company.imapHost || '',
            imapUser: company.imapUser || '',
            imapPassword: company.imapPassword || '',
            imapPort: company.imapPort || 993
        });
    };

    const handleAddNew = () => {
        setEditingId('new');
        setFormData({ name: '', emailAddress: '', imapHost: '', imapUser: '', imapPassword: '', imapPort: 993 });
    };

    const handleSave = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.emailAddress) {
            alert(t('settingsPage.errorPrefix') + ": " + t('settingsPage.requiredFieldsError'));
            return;
        }
        const idToProcess = editingId;
        const dataToProcess = { ...formData, imapPort: typeof formData.imapPort === 'number' ? formData.imapPort : 993 };
        try {
            if (idToProcess === 'new') {
                await addCompany(dataToProcess);
            } else if (idToProcess) {
                await updateCompany(idToProcess, dataToProcess);
            }
            setEditingId(null);
            setFormData({ name: '', emailAddress: '', imapHost: '', imapUser: '', imapPassword: '', imapPort: 993 });
        } catch (error) {
            console.error("Failed to save", error);
            alert(t('settingsPage.errorPrefix') + " " + error);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(t('settingsPage.confirmDelete'))) {
            try { await deleteCompany(id); } catch (error) {
                console.error("Failed to delete", error);
                alert(t('settingsPage.failedDelete'));
            }
        }
    };

    return (
        <div className="dashboard-container" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={onBack} style={{
                        background: 'transparent', border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)', padding: '0.4rem 0.8rem',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    }}>{t('settingsPage.back')}</button>
                    <h2>{t('settingsPage.title')}</h2>
                </div>
            </div>

            {/* ── ROLES SECTION ────────────────────────────────────────────── */}
            <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3>{t('settingsPage.rolesTitle')}</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.3rem 0 0 0' }}>
                            {t('settingsPage.yourRole')} <strong>{currentRole}</strong>
                        </p>
                    </div>
                    {(currentRole === 'master' || currentRole === 'admin') && (
                        <button onClick={loadUsers} style={{
                            background: 'transparent', border: '1px solid var(--border-color)',
                            color: 'var(--primary-color)', padding: '0.4rem 0.8rem',
                            borderRadius: '4px', cursor: 'pointer'
                        }}>
                            {usersLoading ? t('settingsPage.loading') : t('settingsPage.manageUsers')}
                        </button>
                    )}
                </div>
                {(currentRole === 'master' || currentRole === 'admin') && users.length > 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                        {roleMsg && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{roleMsg}</p>}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-secondary)' }}>Email</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-secondary)' }}>{t('settingsPage.roleCol')}</th>
                                    <th style={{ padding: '0.5rem' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => (
                                    <tr key={u.uid} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '0.5rem' }}>{u.email}</td>
                                        <td style={{ padding: '0.5rem' }}>
                                            <select
                                                value={u.role}
                                                onChange={e => setUsers(prev => prev.map(x => x.uid === u.uid ? { ...x, role: e.target.value } : x))}
                                                style={{ background: 'var(--surface-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.2rem 0.4rem' }}>
                                                <option value="user">user</option>
                                                <option value="admin">admin</option>
                                                {currentRole === 'master' && <option value="master">master</option>}
                                            </select>
                                        </td>
                                        <td style={{ padding: '0.5rem' }}>
                                            <button onClick={() => handleSetRole(u.uid, u.role)} style={{
                                                background: 'var(--header-accent)', color: 'white', border: 'none',
                                                padding: '0.3rem 0.7rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem'
                                            }}>{t('settingsPage.roleSaveBtn')}</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── GLOBAL AI RULES SECTION ──────────────────────────────────── */}
            <div className="table-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3>{t('settingsPage.globalRulesTitle') || 'AI Processing Rules'}</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.3rem 0 0 0' }}>
                            {t('settingsPage.globalRulesDesc') || 'Global rules for all companies. Auto-learned from manual corrections.'}
                        </p>
                    </div>
                    <button onClick={() => setShowRules(!showRules)} style={{
                        background: showRules ? 'var(--surface-color)' : 'transparent',
                        border: '1px solid var(--border-color)', color: 'var(--primary-color)',
                        padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                    }}>
                        {t('settingsPage.instructionsBtn')} {rulesList.length > 0 ? `(${rulesList.length})` : ''}
                    </button>
                </div>

                {showRules && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                        {rulesLoading ? (
                            <div className="loader">{t('settingsPage.loading')}</div>
                        ) : rulesList.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic', margin: '0 0 1rem 0' }}>{t('settingsPage.noInstructions')}</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                                {rulesList.map((ruleText, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface-color)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                        {editingRuleIdx === idx ? (
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <textarea rows={3}
                                                    value={editingRuleText}
                                                    onChange={e => setEditingRuleText(e.target.value)}
                                                    autoFocus
                                                    style={{
                                                        width: '100%', boxSizing: 'border-box', padding: '0.5rem',
                                                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                                                        background: 'var(--background-color)', color: 'var(--text-primary)',
                                                        fontSize: '0.9rem', lineHeight: 1.4, resize: 'vertical', fontFamily: 'inherit'
                                                    }}
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button onClick={handleSaveEditedRule} disabled={!editingRuleText.trim()}
                                                        style={{ background: 'var(--header-accent)', color: 'white', border: 'none', padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', cursor: editingRuleText.trim() ? 'pointer' : 'not-allowed', fontSize: '0.85rem', opacity: editingRuleText.trim() ? 1 : 0.5 }}>
                                                        {t('settingsPage.saveRuleBtn') || 'Save'}
                                                    </button>
                                                    <button onClick={handleCancelEditRule}
                                                        style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem' }}>
                                                        {t('settingsPage.cancelRuleBtn') || 'Cancel'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4, flex: 1 }}>{ruleText}</span>
                                                <div style={{ display: 'flex', gap: '0.4rem', marginLeft: '1rem' }}>
                                                    <button onClick={() => handleStartEditRule(idx)}
                                                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.2rem', opacity: 0.7 }}
                                                        title={t('settingsPage.editRuleTooltip') || 'Edit rule'}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                                    </button>
                                                    <button onClick={() => handleDeleteSingleRule(idx)}
                                                        style={{ background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', padding: '0.2rem', opacity: 0.7 }}
                                                        title={t('settingsPage.deleteRuleTooltip')}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                                <button onClick={handleClearAllRules}
                                    style={{ alignSelf: 'flex-start', marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', fontSize: '0.85rem', padding: '0.4rem 0' }}>
                                    {t('settingsPage.deleteAllBtn')} ({rulesList.length})
                                </button>
                            </div>
                        )}

                        <div style={{ borderTop: rulesList.length > 0 ? '1px solid var(--border-color)' : 'none', paddingTop: rulesList.length > 0 ? '1rem' : 0 }}>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                {t('settingsPage.addRuleLabel') || 'Add rule:'}
                            </label>
                            <textarea rows={3}
                                placeholder={t('settingsPage.addRulePlaceholder') || 'Example: For vendors Pronto and Inovatus, due date = invoice date + 30 days.'}
                                value={newRuleText}
                                onChange={e => setNewRuleText(e.target.value)}
                                style={{
                                    width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.8rem',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                                    background: 'var(--surface-color)', color: 'var(--text-primary)',
                                    fontSize: '0.9rem', lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit'
                                }}
                            />
                            <button onClick={handleAddRule} disabled={!newRuleText.trim()}
                                style={{
                                    marginTop: '0.5rem', background: 'var(--header-accent)', color: 'white',
                                    border: 'none', padding: '0.5rem 1.1rem', borderRadius: 'var(--radius-sm)',
                                    cursor: newRuleText.trim() ? 'pointer' : 'not-allowed', fontSize: '0.9rem',
                                    opacity: newRuleText.trim() ? 1 : 0.5
                                }}>
                                {t('settingsPage.addRuleBtn') || 'Save rule'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── COMPANIES SECTION ───────────────────────────────────────── */}
            <div className="table-container" style={{ padding: '2rem' }}>
                <h3>{t('settingsPage.manageTitle')}</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                    {t('settingsPage.manageDesc')}
                </p>

                {companiesLoading ? (
                    <div className="loader">{t('settingsPage.loading')}</div>
                ) : companiesError ? (
                    <div style={{ color: 'var(--status-overdue-text)' }}>{t('settingsPage.errorPrefix')}: {companiesError}</div>
                ) : (
                    <div>
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                            {companies.map(c => (
                                <li key={c.id} style={{ border: '1px solid var(--border-color)', marginBottom: '1rem', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ flex: 1, paddingRight: '1rem' }}>
                                            <strong style={{ fontSize: '1.1rem' }}>{c.name}</strong>{c.emailAddress ? `, email: ${c.emailAddress}` : ''}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                            <button onClick={() => handleEdit(c)} style={{
                                                background: 'transparent', border: '1px solid var(--border-color)',
                                                color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                            }}>{t('settingsPage.editBtn')}</button>
                                            <button onClick={() => handleDelete(c.id)} style={{
                                                color: 'var(--status-overdue-text)', border: '1px solid currentColor',
                                                background: 'transparent', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                            }}>{t('settingsPage.deleteBtn')}</button>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {editingId ? (
                            <div style={{ padding: '1.5rem', border: '1px solid var(--header-accent)', borderRadius: 'var(--radius-md)', background: 'var(--surface-color)', marginTop: '1rem' }}>
                                <h4>{editingId === 'new' ? t('settingsPage.newCompany') : t('settingsPage.editCompany')}</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.nameLabel')}</label>
                                        <input type="text" placeholder={t('settingsPage.namePlaceholder')} className="search-input"
                                            value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.emailLabel')}</label>
                                        <input type="email" placeholder="invoicetracker2026@gmail.com" className="search-input"
                                            value={formData.emailAddress} onChange={e => setFormData({ ...formData, emailAddress: e.target.value })} />
                                    </div>
                                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                                        <h5 style={{ marginBottom: '1rem' }}>{t('settingsPage.imapTitle')}</h5>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{t('settingsPage.imapDesc')}</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapHost')}</label>
                                                <input type="text" autoComplete="off" placeholder="imap.gmail.com" className="search-input"
                                                    value={formData.imapHost} onChange={e => setFormData({ ...formData, imapHost: e.target.value })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapPort')}</label>
                                                <input type="number" placeholder="993" className="search-input"
                                                    value={formData.imapPort} onChange={e => setFormData({ ...formData, imapPort: parseInt(e.target.value) || 993 })} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapUser')}</label>
                                                <input type="email" autoComplete="new-password" placeholder="office@company.com" className="search-input"
                                                    value={formData.imapUser} onChange={e => setFormData({ ...formData, imapUser: e.target.value })} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapPass')}</label>
                                                <input type="password" autoComplete="new-password" placeholder="••••••••••••••••" className="search-input"
                                                    value={formData.imapPassword} onChange={e => setFormData({ ...formData, imapPassword: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <button onClick={handleSave} style={{
                                            background: 'var(--header-accent)', color: 'white', border: 'none',
                                            padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500
                                        }}>{t('settingsPage.saveBtn')}</button>
                                        <button onClick={() => setEditingId(null)} style={{
                                            background: 'transparent', border: '1px solid var(--border-color)',
                                            color: 'var(--text-primary)', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer'
                                        }}>{t('settingsPage.cancelBtn')}</button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button onClick={handleAddNew} style={{
                                background: 'transparent', color: 'var(--text-primary)',
                                border: '1px dashed var(--border-color)', padding: '1rem 1.2rem',
                                borderRadius: 'var(--radius-md)', cursor: 'pointer', marginTop: '1rem',
                                width: '100%', fontSize: '1rem', opacity: 0.8
                            }}>{t('settingsPage.addBtn')}</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
