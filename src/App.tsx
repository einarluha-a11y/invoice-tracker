import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InvoiceTable } from './components/InvoiceTable';
import { Login } from './components/Login';
import { useAuth } from './context/AuthContext';
import { InvoiceStatus, Invoice, mockInvoices } from './data/mockInvoices';
import { fetchInvoices } from './data/api';
import { Settings } from './components/Settings';
import { useCompanies, Company } from './hooks/useCompanies';
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

    // Automatically select the first company when data loads
    useEffect(() => {
        if (!selectedCompanyId && companies.length > 0) {
            setSelectedCompanyId(companies[0].id);
        }
    }, [companies, selectedCompanyId]);

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            if (!selectedCompanyId) {
                setInvoices([]);
                setIsLoading(false);
                return;
            }

            const company = companies.find(c => c.id === selectedCompanyId);

            try {
                setIsLoading(true);
                setError(null);

                // If url is empty, default to mock data
                if (!company || !company.csvUrl) {
                    console.log(`No Google Sheets URL found for company ${company ? company.name : 'Unknown'}. Using mock data.`);
                    setInvoices(mockInvoices);
                } else {
                    const data = await fetchInvoices(company.csvUrl);
                    setInvoices(data);
                }
            } catch (err) {
                console.error("Failed to fetch invoices:", err);
                setError(t('errors.loadingDesc'));
                setInvoices([]); // Set to empty on error, do NOT use mock data here
            } finally {
                setIsLoading(false);
            }
        };

        loadData();

        // Set up the interval for auto-refresh (120000 ms = 2 minutes)
        const refreshInterval = setInterval(() => {
            console.log(`Auto-refreshing invoices for company ${selectedCompanyId}...`);
            loadData();
        }, 120000);

        // Cleanup interval on unmount or when selectedCompanyId changes
        return () => clearInterval(refreshInterval);
    }, [selectedCompanyId, companies, t]);

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
        if (startDate) {
            matchesDate = invoice.dateCreated >= startDate;
        }
        if (endDate) {
            matchesDate = matchesDate && invoice.dateCreated <= endDate;
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
                        onChange={(e) => i18n.changeLanguage(e.target.value)}
                    >
                        <option value="ru">RU</option>
                        <option value="en">EN</option>
                        <option value="et">ET</option>
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
                                Настройки
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
                                Выйти
                            </button>
                        </>
                    )}
                </div>
            </header>

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
                />
            )}
        </div>
    );
}

export default App;
