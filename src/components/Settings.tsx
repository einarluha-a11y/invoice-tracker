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
    const [formData, setFormData] = useState({ name: '', csvUrl: '', receivingEmail: '' });

    const handleEdit = (company: any) => {
        setEditingId(company.id);
        setFormData({ name: company.name, csvUrl: company.csvUrl, receivingEmail: company.receivingEmail || '' });
    };

    const handleAddNew = () => {
        setEditingId('new');
        setFormData({ name: '', csvUrl: '', receivingEmail: '' });
    };

    const handleSave = async () => {
        if (!formData.name || !formData.csvUrl) {
            alert("Имя и CSV URL обязательны.");
            return;
        }

        try {
            if (editingId === 'new') {
                await addCompany({ ...formData });
            } else if (editingId) {
                await updateCompany(editingId, { ...formData });
            }
            setEditingId(null);
        } catch (error) {
            console.error("Failed to save", error);
            alert("Failed to save changes.");
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Вы уверены, что хотите удалить эту компанию?')) {
            try {
                await deleteCompany(id);
            } catch (error) {
                console.error("Failed to delete", error);
                alert("Failed to delete company.");
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
                        ← Назад
                    </button>
                    <h2>Настройки</h2>
                </div>
            </div>

            <div className="table-container" style={{ padding: '2rem' }}>
                <h3>Управление Компаниями</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                    Здесь вы можете настроить список компаний, привязав к ним ссылки на CSV данные из Google Таблиц.
                </p>

                {companiesLoading ? (
                    <div className="loader">Загрузка компаний...</div>
                ) : companiesError ? (
                    <div style={{ color: 'var(--status-overdue-text)' }}>Ошибка: {companiesError}</div>
                ) : (
                    <div>
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                            {companies.map(c => (
                                <li key={c.id} style={{ padding: '1rem', border: '1px solid var(--border-color)', marginBottom: '1rem', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1, paddingRight: '1rem' }}>
                                        <strong style={{ fontSize: '1.1rem' }}>{c.name}</strong>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.6rem', wordBreak: 'break-all' }}>
                                            <strong>CSV:</strong> <a href={c.csvUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{c.csvUrl}</a>
                                        </div>
                                        {c.receivingEmail && (
                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                                                <strong>Входящий Email:</strong> {c.receivingEmail}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                        <button onClick={() => handleEdit(c)} style={{
                                            background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                        }}>
                                            Редактировать
                                        </button>
                                        <button onClick={() => handleDelete(c.id)} style={{
                                            color: 'var(--status-overdue-text)', border: '1px solid currentColor', background: 'transparent', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer'
                                        }}>
                                            Удалить
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {editingId ? (
                            <div style={{ padding: '1.5rem', border: '1px solid var(--header-accent)', borderRadius: 'var(--radius-md)', background: 'var(--surface-color)', marginTop: '1rem' }}>
                                <h4>{editingId === 'new' ? 'Новая компания' : 'Редактировать компанию'}</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Название фирмы *</label>
                                        <input
                                            type="text"
                                            placeholder="ООО Ромашка"
                                            className="search-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Google Sheets CSV ссылка *</label>
                                        <input
                                            type="text"
                                            placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv"
                                            className="search-input"
                                            value={formData.csvUrl}
                                            onChange={e => setFormData({ ...formData, csvUrl: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Reception Email (Для автоматизации)</label>
                                        <input
                                            type="email"
                                            placeholder="invoice-robot@yourdomain.com"
                                            className="search-input"
                                            value={formData.receivingEmail}
                                            onChange={e => setFormData({ ...formData, receivingEmail: e.target.value })}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <button onClick={handleSave} style={{
                                            background: 'var(--header-accent)', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500
                                        }}>
                                            Сохранить
                                        </button>
                                        <button onClick={() => setEditingId(null)} style={{
                                            background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-md)', cursor: 'pointer'
                                        }}>
                                            Отмена
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
                                + Добавить новую компанию
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
