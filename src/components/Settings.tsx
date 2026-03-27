import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompanies } from '../hooks/useCompanies';

interface SettingsProps {
    onBack: () => void;
}

export function Settings({ onBack }: SettingsProps) {
    const { t } = useTranslation();
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
        e.preventDefault(); // Prevent accidental form submissions if there are any forms wrapping this

        if (!formData.name || !formData.emailAddress) {
            alert(t('settingsPage.errorPrefix') + ": Имя и Email обязательны.");
            return;
        }

        const idToProcess = editingId;
        const dataToProcess = {
            ...formData,
            imapPort: typeof formData.imapPort === 'number' ? formData.imapPort : 993
        };

        try {
            if (idToProcess === 'new') {
                await addCompany(dataToProcess);
            } else if (idToProcess) {
                await updateCompany(idToProcess, dataToProcess);
            }

            // Only close and clear AFTER a successful database operation
            setEditingId(null);
            setFormData({ name: '', emailAddress: '', imapHost: '', imapUser: '', imapPassword: '', imapPort: 993 });
        } catch (error) {
            console.error("Failed to save", error);
            alert(t('settingsPage.errorPrefix') + " " + error);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(t('settingsPage.confirmDelete'))) {
            try {
                await deleteCompany(id);
            } catch (error) {
                console.error("Failed to delete", error);
                alert(t('settingsPage.failedDelete'));
            }
        }
    };

    const [expandedInstructionsId, setExpandedInstructionsId] = useState<string | null>(null);
    const [newRuleText, setNewRuleText] = useState<string>('');

    const handleAddRule = async (companyId: string, currentRules: string) => {
        const trimmed = newRuleText.trim();
        if (!trimmed) return;
        const updated = currentRules ? currentRules + '\n' + trimmed : trimmed;
        try {
            await updateCompany(companyId, { customAiRules: updated });
            setNewRuleText('');
        } catch (error) {
            console.error("Failed to add rule", error);
            alert(t('settingsPage.errorPrefix') + " " + error);
        }
    };

    const handleDeleteSingleRule = async (companyId: string, ruleIndex: number, currentRules: string) => {
        const rulesArray = currentRules.split('\n').filter(r => r.trim() !== '');
        rulesArray.splice(ruleIndex, 1);
        const newRules = rulesArray.join('\n');
        try {
            await updateCompany(companyId, { customAiRules: newRules });
        } catch (error) {
            console.error("Failed to update rules", error);
            alert(t('settingsPage.deleteRuleError'));
        }
    };

    const handleClearAllRules = async (companyId: string) => {
        if (window.confirm(t('settingsPage.confirmClearRules'))) {
            try {
                await updateCompany(companyId, { customAiRules: '' });
                setExpandedInstructionsId(null);
            } catch (error) {
                console.error("Failed to clear rules", error);
            }
        }
    };

    return (
        <div className="dashboard-container" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)',
                            padding: '0.4rem 0.8rem',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                        }}
                    >
                        {t('settingsPage.back')}
                    </button>
                    <h2>{t('settingsPage.title')}</h2>
                </div>
            </div>

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
                            {companies.map(c => {
                                const rulesList = (c.customAiRules || '').split('\n').filter((r: string) => r.trim() !== '');
                                return (
                                    <li key={c.id} style={{ border: '1px solid var(--border-color)', marginBottom: '1rem', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ flex: 1, paddingRight: '1rem' }}>
                                                <strong style={{ fontSize: '1.1rem' }}>{c.name}</strong>{c.emailAddress ? `, email: ${c.emailAddress}` : ''}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                                <button onClick={() => setExpandedInstructionsId(expandedInstructionsId === c.id ? null : c.id)} style={{
                                                    background: expandedInstructionsId === c.id ? 'var(--surface-color)' : 'transparent',
                                                    border: '1px solid var(--border-color)', color: 'var(--primary-color)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                                }}>
                                                    {t('settingsPage.instructionsBtn')} {rulesList.length > 0 ? `(${rulesList.length})` : ''}
                                                </button>
                                                <button onClick={() => handleEdit(c)} style={{
                                                    background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                                }}>
                                                    {t('settingsPage.editBtn')}
                                                </button>
                                                <button onClick={() => handleDelete(c.id)} style={{
                                                    color: 'var(--status-overdue-text)', border: '1px solid currentColor', background: 'transparent', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                                }}>
                                                    {t('settingsPage.deleteBtn')}
                                                </button>
                                            </div>
                                        </div>

                                        {expandedInstructionsId === c.id && (
                                            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-color)', borderBottomLeftRadius: 'var(--radius-md)', borderBottomRightRadius: 'var(--radius-md)' }}>
                                                <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{t('settingsPage.currentInstructionsTitle')} {c.name}:</h4>
                                                {rulesList.length === 0 ? (
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic', margin: '0 0 1rem 0' }}>{t('settingsPage.noInstructions')}</p>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                                                        {rulesList.map((ruleText: string, idx: number) => (
                                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface-color)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{ruleText}</span>
                                                                <button
                                                                    onClick={() => handleDeleteSingleRule(c.id, idx, c.customAiRules || '')}
                                                                    style={{ background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', padding: '0.2rem', marginLeft: '1rem', opacity: 0.7 }}
                                                                    title={t('settingsPage.deleteRuleTooltip')}
                                                                >
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <button
                                                            onClick={() => handleClearAllRules(c.id)}
                                                            style={{ alignSelf: 'flex-start', marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', fontSize: '0.85rem', padding: '0.4rem 0' }}
                                                        >
                                                            {t('settingsPage.deleteAllBtn')} ({rulesList.length})
                                                        </button>
                                                    </div>
                                                )}
                                                {/* ADD NEW RULE */}
                                                <div style={{ borderTop: rulesList.length > 0 ? '1px solid var(--border-color)' : 'none', paddingTop: rulesList.length > 0 ? '1rem' : 0 }}>
                                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                        {t('settingsPage.addRuleLabel') || 'Добавить инструкцию:'}
                                                    </label>
                                                    <textarea
                                                        rows={3}
                                                        placeholder={t('settingsPage.addRulePlaceholder') || 'Например: Для вендоров Pronto и Inovatus срок оплаты = дата инвойса + 30 дней.'}
                                                        value={expandedInstructionsId === c.id ? newRuleText : ''}
                                                        onChange={e => setNewRuleText(e.target.value)}
                                                        style={{
                                                            width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.8rem',
                                                            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                                                            background: 'var(--surface-color)', color: 'var(--text-primary)',
                                                            fontSize: '0.9rem', lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit'
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => handleAddRule(c.id, c.customAiRules || '')}
                                                        disabled={!newRuleText.trim()}
                                                        style={{
                                                            marginTop: '0.5rem', background: 'var(--header-accent)', color: 'white',
                                                            border: 'none', padding: '0.5rem 1.1rem', borderRadius: 'var(--radius-sm)',
                                                            cursor: newRuleText.trim() ? 'pointer' : 'not-allowed', fontSize: '0.9rem',
                                                            opacity: newRuleText.trim() ? 1 : 0.5
                                                        }}
                                                    >
                                                        {t('settingsPage.addRuleBtn') || 'Сохранить инструкцию'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>

                        {editingId ? (
                            <div style={{ padding: '1.5rem', border: '1px solid var(--header-accent)', borderRadius: 'var(--radius-md)', background: 'var(--surface-color)', marginTop: '1rem' }}>
                                <h4>{editingId === 'new' ? t('settingsPage.newCompany') : t('settingsPage.editCompany')}</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.nameLabel')}</label>
                                        <input
                                            type="text"
                                            placeholder={t('settingsPage.namePlaceholder')}
                                            className="search-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.emailLabel')}</label>
                                        <input
                                            type="email"
                                            placeholder="invoicetracker2026@gmail.com"
                                            className="search-input"
                                            value={formData.emailAddress}
                                            onChange={e => setFormData({ ...formData, emailAddress: e.target.value })}
                                        />
                                    </div>

                                    {/* IMAP SETTINGS */}
                                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                                        <h5 style={{ marginBottom: '1rem' }}>{t('settingsPage.imapTitle')}</h5>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                            {t('settingsPage.imapDesc')}
                                        </p>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapHost')}</label>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    placeholder="imap.gmail.com"
                                                    className="search-input"
                                                    value={formData.imapHost}
                                                    onChange={e => setFormData({ ...formData, imapHost: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapPort')}</label>
                                                <input
                                                    type="number"
                                                    placeholder="993"
                                                    className="search-input"
                                                    value={formData.imapPort}
                                                    onChange={e => setFormData({ ...formData, imapPort: parseInt(e.target.value) || 993 })}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapUser')}</label>
                                                <input
                                                    type="email"
                                                    autoComplete="new-password"
                                                    placeholder="office@company.com"
                                                    className="search-input"
                                                    value={formData.imapUser}
                                                    onChange={e => setFormData({ ...formData, imapUser: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('settingsPage.imapPass')}</label>
                                                <input
                                                    type="password"
                                                    autoComplete="new-password"
                                                    placeholder="••••••••••••••••"
                                                    className="search-input"
                                                    value={formData.imapPassword}
                                                    onChange={e => setFormData({ ...formData, imapPassword: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <button onClick={handleSave} style={{
                                            background: 'var(--header-accent)', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500
                                        }}>
                                            {t('settingsPage.saveBtn')}
                                        </button>
                                        <button onClick={() => setEditingId(null)} style={{
                                            background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer'
                                        }}>
                                            {t('settingsPage.cancelBtn')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button onClick={handleAddNew} style={{
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                border: '1px dashed var(--border-color)',
                                padding: '1rem 1.2rem',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                marginTop: '1rem',
                                width: '100%',
                                fontSize: '1rem',
                                opacity: 0.8
                            }}>
                                {t('settingsPage.addBtn')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
