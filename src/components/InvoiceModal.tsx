import { useState } from 'react';
import { Invoice, InvoiceStatus } from '../data/mockInvoices';
import { useTranslation } from 'react-i18next';

interface InvoiceModalProps {
    invoice: Invoice | null;
    onClose: () => void;
    onSave: (id: string, updatedData: Partial<Invoice>) => Promise<void>;
}

export function InvoiceModal({ invoice, onClose, onSave }: InvoiceModalProps) {
    const { t } = useTranslation();
    const [vendor, setVendor] = useState(invoice?.vendor || '');
    const [description, setDescription] = useState(invoice?.description || '');
    const [amount, setAmount] = useState(invoice?.amount?.toString() || '');
    const [currency, setCurrency] = useState(invoice?.currency || 'EUR');
    // Ensure format is YYYY-MM-DD for the date inputs
    const safeDate = (dateStr: string | undefined) => dateStr ? dateStr.substring(0, 10) : '';
    const [dateCreated, setDateCreated] = useState(safeDate(invoice?.dateCreated));
    const [dueDate, setDueDate] = useState(safeDate(invoice?.dueDate));
    const [status, setStatus] = useState<InvoiceStatus>(invoice?.status || 'Pending');
    const [isSaving, setIsSaving] = useState(false);

    if (!invoice) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(invoice.id, {
                vendor,
                description,
                amount: parseFloat(amount) || 0,
                currency,
                dateCreated,
                dueDate,
                status
            });
            onClose();
        } catch (error) {
            console.error(error);
            alert(t('modal.saveError'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(9, 11, 15, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '650px', width: '90%',
                background: 'linear-gradient(145deg, var(--bg-card), var(--bg-secondary))',
                padding: '2.5rem',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05)',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Decorative glow */}
                <div style={{
                    position: 'absolute', top: '-100px', left: '-100px', width: '200px', height: '200px',
                    background: 'radial-gradient(circle, rgba(88,166,255,0.15) 0%, rgba(0,0,0,0) 70%)',
                    borderRadius: '50%', pointerEvents: 'none'
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
                    <h2 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                        {t('modal.title')}
                    </h2>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer', transition: 'color 0.2s' }} title={t('modal.cancelBtn')}>×</button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>

                        {/* Left Column */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.vendor')}</span>
                                <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} required
                                    className="settings-input"
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: '#fff', transition: 'all 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}
                                />
                            </label>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.description')}</span>
                                <textarea value={description} onChange={e => setDescription(e.target.value)}
                                    className="settings-input"
                                    placeholder={t('modal.descriptionPlaceholder')}
                                    style={{ width: '100%', resize: 'vertical', minHeight: '80px', fontFamily: 'inherit', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: '#fff', transition: 'all 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}
                                />
                            </label>
                        </div>

                        {/* Right Column */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.amount')}</span>
                                    <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required
                                        className="settings-input"
                                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: '#fff', fontSize: '1.1rem', fontWeight: 500, fontFamily: 'monospace' }}
                                    />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.currency')}</span>
                                    <input type="text" value={currency} onChange={e => setCurrency(e.target.value)} required
                                        className="settings-input"
                                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: '#fff', textAlign: 'center' }}
                                    />
                                </label>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.created')}</span>
                                    <input type="date" value={dateCreated} onChange={e => setDateCreated(e.target.value)} required
                                        className="settings-input"
                                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: 'var(--text-primary)' }}
                                    />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.dueDate')}</span>
                                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required
                                        className="settings-input"
                                        style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: 'var(--text-primary)' }}
                                    />
                                </label>
                            </div>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('modal.status')}</span>
                                <select value={status} onChange={e => setStatus(e.target.value as InvoiceStatus)}
                                    className="settings-input"
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: '#fff', appearance: 'none', cursor: 'pointer' }}>
                                    <option value="Pending">{t('filters.pending')}</option>
                                    <option value="Paid">{t('filters.paid')}</option>
                                    <option value="Overdue">{t('filters.overdue')}</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <button type="button" onClick={onClose}
                            style={{
                                borderRadius: 'var(--radius-md)', padding: '0.75rem 1.5rem',
                                border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)',
                                background: 'transparent', cursor: 'pointer', fontWeight: 500,
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.color = '#fff'}
                            onMouseOut={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                            disabled={isSaving}>
                            {t('modal.cancelBtn')}
                        </button>
                        <button type="submit"
                            style={{
                                borderRadius: 'var(--radius-md)', padding: '0.75rem 2rem',
                                background: 'linear-gradient(135deg, var(--accent-color), #3b82f6)',
                                color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
                                boxShadow: '0 4px 14px 0 rgba(88, 166, 255, 0.39)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                            disabled={isSaving}>
                            {isSaving ? t('modal.savingBtn') : t('modal.saveBtn')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
