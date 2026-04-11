import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InvoiceTable, SortField, SortDirection } from './components/InvoiceTable';
import { Login } from './components/Login';
import { useAuth } from './context/AuthContext';
import type { InvoiceStatus, Invoice } from './data/types';
import { subscribeToInvoices, archiveInvoice, restoreInvoice, updateInvoice } from './data/api';
import { db } from './firebase';
import { Settings } from './components/Settings';
import { useCompanies, Company } from './hooks/useCompanies';
import { InvoiceModal } from './components/InvoiceModal';
import { AiChat } from './components/AiChat';
import './App.css';

function MasterPasswordGate({ verifyMasterPassword, logout }: { verifyMasterPassword: (p: string) => Promise<boolean>; logout: () => Promise<void> }) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [attempts, setAttempts] = useState(0);
    const [lockedUntil, setLockedUntil] = useState(0);

    const isLocked = Date.now() < lockedUntil;
    const lockSeconds = isLocked ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;

    const handleVerify = async () => {
        if (isLocked) return;
        setLoading(true);
        setError('');
        const ok = await verifyMasterPassword(password);
        if (!ok) {
            const newAttempts = attempts + 1;
            setAttempts(newAttempts);
            if (newAttempts >= 3) {
                setLockedUntil(Date.now() + 30000);
                setAttempts(0);
                setError(t('master.tooManyAttempts'));
                // Auto-unlock UI after 30s
                setTimeout(() => setLockedUntil(0), 30000);
            } else {
                setError(t('master.invalidPassword'));
            }
        }
        setLoading(false);
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title" style={{ fontSize: '1.4rem' }}>{t('master.step2')}</h1>
                {error && <div className="login-error">{error}</div>}
                <input
                    className="login-input"
                    type="password"
                    placeholder={t('master.masterPasswordPlaceholder')}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    onKeyDown={e => e.key === 'Enter' && !isLocked && handleVerify()}
                    style={{ marginTop: '1rem' }}
                    disabled={isLocked}
                />
                <button
                    className="btn-login-primary"
                    onClick={handleVerify}
                    disabled={loading || isLocked}
                    style={{ marginTop: '0.75rem' }}
                >
                    {isLocked ? `${t('master.locked')} (${lockSeconds}s)` : loading ? t('master.verifying') : t('master.verifyBtn')}
                </button>
                <button
                    onClick={logout}
                    style={{
                        marginTop: '1rem',
                        padding: '0.6rem 1.2rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        width: '100%',
                    }}
                >
                    {t('logout')}
                </button>
            </div>
        </div>
    );
}

function AccountSelector() {
    const { availableAccounts, selectAccount, logout } = useAuth();
    const { t } = useTranslation();
    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title" style={{ fontSize: '1.4rem' }}>{t('accountSelector.title')}</h1>
                {availableAccounts.length === 0 ? (
                    <div style={{ marginTop: '1rem', color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.95rem' }}>
                        <p>{t('accountSelector.noAccounts')}</p>
                        <button
                            onClick={logout}
                            style={{
                                marginTop: '1rem',
                                padding: '0.6rem 1.2rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                            }}
                        >
                            {t('logout')}
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                        {availableAccounts.map(acc => (
                            <button
                                key={acc.id}
                                onClick={() => selectAccount(acc.id)}
                                style={{
                                    padding: '0.75rem 1rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.95rem',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                {acc.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function App() {
    const { t, i18n } = useTranslation();
    const { user, loading: authLoading, logout, isFirebaseConfigured, isMaster, masterPasswordVerified, verifyMasterPassword, currentAccountId, availableAccounts, selectAccount, userRole } = useAuth();
    const { companies, companiesLoading, companiesError } = useCompanies();

    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All' | 'Unpaid'>('All');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
    const [showArchived, setShowArchived] = useState(false);
    const [sortField, setSortField] = useState<SortField>('dateCreated');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [dateFilterType, setDateFilterType] = useState<'created' | 'due'>('due');

    // Reset selected company when account changes
    useEffect(() => {
        setSelectedCompanyId('');
    }, [currentAccountId]);

    // При смене списка компаний — сбросить выбор на первую компанию
    useEffect(() => {
        if (companies.length > 0) {
            setSelectedCompanyId(companies[0].id);
        } else {
            setSelectedCompanyId('');
        }
    }, [companies]);

    // Load all invoices — no pagination needed for <1000 records
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const activeCompany = companies.find(c => c.id === selectedCompanyId);

    const isValidDateString = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());

    const handleApplyAiFilters = (filters: { searchTerm?: string, status?: string, dateFrom?: string, dateTo?: string, dateFilterType?: 'created' | 'due' }) => {
        if (filters.searchTerm !== undefined) setSearchTerm(filters.searchTerm);
        if (filters.status !== undefined) {
            const validStatus = ['All', 'Unpaid', 'Pending', 'Paid', 'Overdue'].includes(filters.status) ? filters.status : 'All';
            setStatusFilter(validStatus as InvoiceStatus | 'All' | 'Unpaid');
        }
        if (filters.dateFilterType !== undefined && ['created', 'due'].includes(filters.dateFilterType)) {
            setDateFilterType(filters.dateFilterType);
        }
        if (filters.dateFrom !== undefined && isValidDateString(filters.dateFrom)) setStartDate(filters.dateFrom);
        if (filters.dateTo !== undefined && isValidDateString(filters.dateTo)) setEndDate(filters.dateTo);
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
            await archiveInvoice(deletingInvoiceId);
            setDeletingInvoiceId(null);
        } catch (err) {
            console.error("Failed to archive", err);
            alert(t('errors.deleteInvoice'));
        }
    };

    const handleRestore = async (id: string) => {
        try {
            await restoreInvoice(id);
        } catch (err) {
            console.error("Failed to restore", err);
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

    // NOTE: CSV/PDF export lives in InvoiceTable.tsx (the "Laadi alla CSV" /
    // "Laadi alla PDF" buttons below the table). The old handleExportCsv helper
    // that lived here powered a duplicate "⬇ CSV" button in the filter row —
    // removed because it exported a hardcoded English header set and
    // duplicated the translated one from InvoiceTable.

    // Stats computed from loaded data using useMemo to prevent main-thread freezing sequentially
    const { totalInvoices, overdueCount, totalAmount } = useMemo(() => {
        const filtered = invoices.filter(invoice => {
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

        return {
            totalInvoices: filtered.length,
            overdueCount: filtered.filter(i => i.status === 'Overdue').length,
            totalAmount: filtered.reduce((sum, inv) => sum + inv.amount, 0)
        };
    }, [invoices, statusFilter, dateFilterType, startDate, endDate]);

    // Block render until auth state is known
    if (authLoading) {
        return (
            <div className="login-container">
                <div className="loader">{t('loadingData')}</div>
            </div>
        );
    }

    // Require Login if not logged in
    if (!user) {
        return <Login />;
    }

    // Master must verify password first
    if (isMaster && !masterPasswordVerified) {
        return <MasterPasswordGate verifyMasterPassword={verifyMasterPassword} logout={logout} />;
    }

    // Master must pick an account first
    if (isMaster && !currentAccountId) {
        return <AccountSelector />;
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
                    <span>Invoice-<span className="header-accent">Tracker</span></span>
                </h1>
                <div className="header-controls" style={{ display: 'flex', gap: '1rem' }}>
                    {isMaster && availableAccounts.length > 1 && (
                        <select
                            className="company-select"
                            value={currentAccountId || ''}
                            onChange={e => { selectAccount(e.target.value); setSelectedCompanyId(''); }}
                        >
                            {availableAccounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    )}
                    <select
                        className="company-select"
                        value={selectedCompanyId}
                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                        disabled={companiesLoading || companies.length === 0}
                    >
                        {companiesLoading ? (
                            <option value="">{t('loadingCompanies')}</option>
                        ) : companies.length === 0 ? (
                            <option value="">{t('noCompanies')}</option>
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
                            {userRole !== 'user' && <button
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
                            </button>}
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
                        {isLoading ? '...' : new Intl.NumberFormat(i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalAmount)}
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
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                        <button
                            onClick={() => setShowArchived(false)}
                            style={{
                                padding: '0.4rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                background: !showArchived ? 'var(--accent)' : 'transparent',
                                color: !showArchived ? '#fff' : 'var(--text-secondary)',
                                border: '1px solid var(--border-color)', fontWeight: !showArchived ? 600 : 400,
                                fontSize: '0.9rem'
                            }}
                        >
                            {t('filters.all')}
                        </button>
                        <button
                            onClick={() => setShowArchived(true)}
                            style={{
                                padding: '0.4rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                                background: showArchived ? 'var(--accent)' : 'transparent',
                                color: showArchived ? '#fff' : 'var(--text-secondary)',
                                border: '1px solid var(--border-color)', fontWeight: showArchived ? 600 : 400,
                                fontSize: '0.9rem'
                            }}
                        >
                            📦 {t('table.archiveTab', 'Archive')}
                        </button>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        {t('table.activeCount', 'Active')}: <strong>{invoices.filter(i => !i.archived).length}</strong>
                        {' · '}
                        {t('table.archivedCount', 'Archived')}: <strong>{invoices.filter(i => i.archived).length}</strong>
                    </div>
                    <InvoiceTable
                        invoices={invoices.filter(i => showArchived ? i.archived === true : !i.archived)}
                        searchTerm={searchTerm}
                        statusFilter={statusFilter}
                        startDate={startDate}
                        endDate={endDate}
                        dateFilterType={dateFilterType}
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
                        onRestore={handleRestore}
                        showArchived={showArchived}
                        companyName={activeCompany?.name}
                        canEdit={userRole !== 'user'}
                    />

                </div>
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
                        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600 }}>{t('modal.archiveTitle', 'Архивировать инвойс')}</h3>
                        <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{t('modal.archiveDesc', 'Переместить инвойс в архив? Его можно будет восстановить позже.')}</p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                            <button onClick={() => setDeletingInvoiceId(null)} style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500, color: '#ffffff', border: '1px solid #d1d5db', background: 'transparent', cursor: 'pointer', fontSize: '1rem' }}>{t('modal.cancelBtn')}</button>
                            <button onClick={confirmDelete} className="btn-primary" style={{ borderRadius: '50px', color: '#fff', padding: '0.75rem 1.5rem', fontWeight: 600, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>{t('modal.archiveConfirm', 'В архив')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
