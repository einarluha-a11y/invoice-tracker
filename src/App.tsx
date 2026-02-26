import { useState, useEffect } from 'react';
import { InvoiceTable } from './components/InvoiceTable';
import { InvoiceStatus, Invoice, mockInvoices } from './data/mockInvoices';
import { fetchInvoices } from './data/api';
import './App.css';

function App() {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All'>('All');

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // If there's no URL configured in .env, we fallback to our beautiful mock data
                // just so the app doesn't look broken when first deployed.
                if (!import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL) {
                    console.log("No Google Sheets URL found. Using mock data.");
                    setInvoices(mockInvoices);
                } else {
                    const data = await fetchInvoices();
                    setInvoices(data);
                }
            } catch (err) {
                console.error("Failed to fetch invoices:", err);
                setError("Не удалось загрузить данные. Проверьте подключение к Google Sheets.");
                setInvoices(mockInvoices); // Fallback on error
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, []);

    // Stats computed from loaded data
    const totalInvoices = invoices.length;
    const overdueCount = invoices.filter(i => i.status === 'Overdue').length;
    const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);

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
            </header>

            <div className="stats-grid">
                <div className="stat-card">
                    <span className="stat-title">Всего инвойсов</span>
                    <span className="stat-value">{isLoading ? '...' : totalInvoices}</span>
                </div>
                <div className="stat-card">
                    <span className="stat-title">Просрочено</span>
                    <span className={`stat-value ${overdueCount > 0 ? 'overdue' : ''}`}>
                        {isLoading ? '...' : overdueCount}
                    </span>
                </div>
                <div className="stat-card">
                    <span className="stat-title">Общая Сумма</span>
                    <span className="stat-value">
                        {isLoading ? '...' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalAmount)}
                    </span>
                </div>
            </div>

            <div className="filters-bar">
                <input
                    type="text"
                    placeholder="Поиск по поставщику или ID..."
                    className="search-input"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'All')}
                >
                    <option value="All">Все статусы</option>
                    <option value="Pending">В ожидании</option>
                    <option value="Paid">Оплачен</option>
                    <option value="Overdue">Просрочен</option>
                </select>
            </div>

            {error ? (
                <div className="table-container empty-state" style={{ color: 'var(--status-overdue-text)' }}>
                    <h3>Ошибка загрузки</h3>
                    <p>{error}</p>
                </div>
            ) : isLoading ? (
                <div className="table-container empty-state">
                    <div className="loader">Загрузка данных...</div>
                </div>
            ) : (
                <InvoiceTable
                    invoices={invoices}
                    searchTerm={searchTerm}
                    statusFilter={statusFilter}
                />
            )}
        </div>
    );
}

export default App;
