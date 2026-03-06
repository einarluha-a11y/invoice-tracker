import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InvoiceTable, SortField, SortDirection } from './components/InvoiceTable';
import { Login } from './components/Login';
import { useAuth } from './context/AuthContext';
import { InvoiceStatus, Invoice, mockInvoices } from './data/mockInvoices';
import { subscribeToInvoices, deleteInvoice, updateInvoice } from './data/api';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Settings } from './components/Settings';
import { useCompanies, Company } from './hooks/useCompanies';
import { InvoiceModal } from './components/InvoiceModal';
import { AiChat } from './components/AiChat';
import './App.css';

function App() {
    const { t, i18n } = useTranslation();
    const { user, loading: authLoading, logout, isFirebaseConfigured } = useAuth();
    const { companies, companiesLoading, companiesError } = useCompanies();

    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All' | 'Unpaid'>('All');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
    const [sortField, setSortField] = useState<SortField>('dateCreated');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [dateFilterType, setDateFilterType] = useState<'created' | 'due'>('due');

    // Automatically select the first company when data loads
    useEffect(() => {
        if (!selectedCompanyId && companies.length > 0) {
            setSelectedCompanyId(companies[0].id);
        }
    }, [companies, selectedCompanyId]);

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const activeCompany = companies.find(c => c.id === selectedCompanyId);

    const handleApplyAiFilters = (filters: { searchTerm?: string, status?: string, dateFrom?: string, dateTo?: string, dateFilterType?: 'created' | 'due' }) => {
        if (filters.searchTerm !== undefined) setSearchTerm(filters.searchTerm);
        if (filters.status !== undefined) {
            const validStatus = ['All', 'Unpaid', 'Pending', 'Paid', 'Overdue'].includes(filters.status) ? filters.status : 'All';
            setStatusFilter(validStatus as InvoiceStatus | 'All' | 'Unpaid');
        }
        if (filters.dateFilterType !== undefined) setDateFilterType(filters.dateFilterType);
        if (filters.dateFrom !== undefined) setStartDate(filters.dateFrom);
        if (filters.dateTo !== undefined) setEndDate(filters.dateTo);
    };

    useEffect(() => {
        if (!selectedCompanyId) {
            setInvoices([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        const unsubscribe = subscribeToInvoices(
            selectedCompanyId,
            (data) => {
                setInvoices(data);
                setIsLoading(false);
            },
            (err) => {
                console.error("Failed to fetch invoices:", err);
                setError(t('errors.loadingDesc'));
                setInvoices([]);
                setIsLoading(false);
            }
        );

        return () => unsubscribe();
    }, [selectedCompanyId, t]);

    const handleEdit = (invoice: Invoice) => {
        setEditingInvoice(invoice);
    };

    const handleDeleteClick = (id: string) => {
        setDeletingInvoiceId(id);
    };

    const confirmDelete = async () => {
        if (!deletingInvoiceId) return;
        try {
            await deleteInvoice(deletingInvoiceId);
            setDeletingInvoiceId(null);
        } catch (err) {
            console.error("Failed to delete", err);
            alert("Ошибка при удалении инвойса");
        }
    };

    const handleSaveInvoice = async (id: string, data: Partial<Invoice>) => {
        try {
            await updateInvoice(id, data);
        } catch (err) {
            console.error("Failed to update", err);
            throw err;
        }
    };

    // Stats computed from loaded data based on selected status filter
    const statsInvoices = invoices.filter(invoice => {
        // Status filter
        let matchesStatus = true;
        if (statusFilter === 'Unpaid') {
            matchesStatus = invoice.status === 'Pending' || invoice.status === 'Overdue';
        } else if (statusFilter !== 'All') {
            matchesStatus = invoice.status === statusFilter;
        }

        // Date filter
        let matchesDate = true;
        const compareDate = dateFilterType === 'due' ? invoice.dueDate : invoice.dateCreated;

        if (startDate) {
            matchesDate = compareDate >= startDate;
        }
        if (endDate) {
            matchesDate = matchesDate && compareDate <= endDate;
        }

        return matchesStatus && matchesDate;
    });

    const totalInvoices = statsInvoices.length;
    const overdueCount = statsInvoices.filter(i => i.status === 'Overdue').length;
    const totalAmount = statsInvoices.reduce((sum, inv) => sum + inv.amount, 0);

    // Block render until auth state is known
    if (authLoading) {
        return (
            <div className="login-container">
                <div className="loader">Loading application...</div>
            </div>
        );
    }

    // Require Login if not logged in
    if (!user) {
        return <Login />;
    }

    // View Router
    if (view === 'settings') {
        return <Settings onBack={() => setView('dashboard')} />;
    }

    return (
        <div className="dashboard-container">
            <header className="header">
                <h1>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="header-accent">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    Kontrol <span className="header-accent">Invoice</span>
                </h1>
                <div className="header-controls" style={{ display: 'flex', gap: '1rem' }}>
                    <select
                        className="company-select"
                        value={selectedCompanyId}
                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                        disabled={companiesLoading || companies.length === 0}
                    >
                        {companiesLoading ? (
                            <option value="">Загрузка...</option>
                        ) : companies.length === 0 ? (
                            <option value="">Нет Компаний ⚙️</option>
                        ) : (
                            companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))
                        )}
                    </select>

                    <select
                        className="company-select"
                        value={i18n.language}
                        onChange={(e) => {
                            i18n.changeLanguage(e.target.value);
                            document.documentElement.lang = e.target.value;
                        }}
                    >
                        <option value="en">EN</option>
                        <option value="et">ET</option>
                        <option value="ru">RU</option>
                    </select>

                    {user && (
                        <>
                            <button
                                onClick={() => setView('settings')}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-secondary)',
                                    padding: '0.4rem 0.8rem',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
                                }}
                            >
                                {t('settings')}
                            </button>
                            <button
                                onClick={logout}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-secondary)',
                                    padding: '0.4rem 0.8rem',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
                                }}
                            >
                                {t('logout')}
                            </button>
                        </>
                    )}
                </div>
            </header>

            {selectedCompanyId && (
                <AiChat key={selectedCompanyId} onApplyFilters={handleApplyAiFilters} />
            )}

            <div className="stats-grid">
                <div className="stat-card">
                    <span className="stat-title">{t('totalInvoices')}</span>
                    <span className="stat-value">{isLoading ? '...' : totalInvoices}</span>
                </div>
                <div className="stat-card">
                    <span className="stat-title">{t('overdue')}</span>
                    <span className={`stat-value ${overdueCount > 0 ? 'overdue' : ''}`}>
                        {isLoading ? '...' : overdueCount}
                    </span>
                </div>
                <div className="stat-card">
                    <span className="stat-title">{t('totalAmount')}</span>
                    <span className="stat-value">
                        {isLoading ? '...' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalAmount)}
                    </span>
                </div>
            </div>

            <div className="filters-bar">
                <input
                    type="text"
                    placeholder={t('searchPlaceholder')}
                    className="search-input"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                        className="filter-select"
                        style={{ padding: '0.6rem', color: 'var(--text-primary)', border: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', fontWeight: 500 }}
                        value={dateFilterType}
                        onChange={(e) => setDateFilterType(e.target.value as 'created' | 'due')}
                    >
                        <option value="due">{t('table.dueDate')}</option>
                        <option value="created">{t('table.created')}</option>
                    </select>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('filters.dateFrom')}</span>
                    <input
                        type="date"
                        className="filter-select"
                        style={{ padding: '0.6rem', color: 'var(--text-primary)' }}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('filters.dateTo')}</span>
                    <input
                        type="date"
                        className="filter-select"
                        style={{ padding: '0.6rem', color: 'var(--text-primary)' }}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'All' | 'Unpaid')}
                >
                    <option value="All">{t('filters.all')}</option>
                    <option value="Unpaid">{t('filters.unpaid')}</option>
                    <option value="Pending">{t('filters.pending')}</option>
                    <option value="Paid">{t('filters.paid')}</option>
                    <option value="Overdue">{t('filters.overdue')}</option>
                </select>
            </div>

            {error ? (
                <div className="table-container empty-state" style={{ color: 'var(--status-overdue-text)' }}>
                    <h3>{t('errors.loadingTitle')}</h3>
                    <p>{error}</p>
                </div>
            ) : isLoading ? (
                <div className="table-container empty-state">
                    <div className="loader">{t('loadingData')}</div>
                </div>
            ) : (
                <InvoiceTable
                    invoices={invoices}
                    searchTerm={searchTerm}
                    statusFilter={statusFilter}
                    startDate={startDate}
                    endDate={endDate}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={(field) => {
                        if (field === sortField) {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                            setSortField(field);
                            setSortDirection('asc');
                        }
                    }}
                    onEdit={handleEdit}
                    onDelete={handleDeleteClick}
                    companyName={activeCompany?.name}
                />
            )}

            {editingInvoice && (
                <InvoiceModal
                    invoice={editingInvoice}
                    onClose={() => setEditingInvoice(null)}
                    onSave={handleSaveInvoice}
                />
            )}

            {deletingInvoiceId && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="modal-content" style={{ maxWidth: '400px', width: '90%', background: 'var(--bg-secondary)', padding: '2rem', borderRadius: 'var(--radius-lg)', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600 }}>Удаление инвойса</h3>
                        <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>Вы уверены, что хотите навсегда удалить этот инвойс? Это действие нельзя отменить.</p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                            <button onClick={() => setDeletingInvoiceId(null)} className="btn-secondary" style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500 }}>Отмена</button>
                            <button onClick={confirmDelete} className="btn-primary" style={{ background: 'var(--status-overdue-text)', border: '2px solid #000', borderRadius: '50px', color: '#fff', padding: '0.75rem 1.5rem', fontWeight: 600, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>Да, удалить</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
