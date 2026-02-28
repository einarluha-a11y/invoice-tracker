import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Invoice, InvoiceStatus } from '../data/mockInvoices';
import './InvoiceTable.css';

interface InvoiceTableProps {
    invoices: Invoice[];
    searchTerm: string;
    statusFilter: InvoiceStatus | 'All' | 'Unpaid';
    startDate?: string;
    endDate?: string;
}

type SortField = keyof Invoice;
type SortDirection = 'asc' | 'desc';

export function InvoiceTable({ invoices, searchTerm, statusFilter, startDate, endDate }: InvoiceTableProps) {
    const { t, i18n } = useTranslation();
    const [sortField, setSortField] = useState<SortField>('dueDate');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const filteredAndSortedInvoices = useMemo(() => {
        return invoices
            .filter((invoice) => {
                const matchesSearch = invoice.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    invoice.id.toLowerCase().includes(searchTerm.toLowerCase());

                let matchesStatus = false;
                if (statusFilter === 'All') {
                    matchesStatus = true;
                } else if (statusFilter === 'Unpaid') {
                    matchesStatus = invoice.status === 'Pending' || invoice.status === 'Overdue';
                } else {
                    matchesStatus = invoice.status === statusFilter;
                }

                let matchesDate = true;
                if (startDate) {
                    matchesDate = invoice.dateCreated >= startDate;
                }
                if (endDate) {
                    matchesDate = matchesDate && invoice.dateCreated <= endDate;
                }

                return matchesSearch && matchesStatus && matchesDate;
            })
            .sort((a, b) => {
                const aValue = a[sortField];
                const bValue = b[sortField];

                let comparison = 0;
                if (aValue > bValue) comparison = 1;
                if (aValue < bValue) comparison = -1;

                return sortDirection === 'asc' ? comparison : -comparison;
            });
    }, [invoices, searchTerm, statusFilter, startDate, endDate, sortField, sortDirection]);

    const formatDate = (dateString: string) => {
        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
        const langCode = i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU';
        return new Date(dateString).toLocaleDateString(langCode, options);
    };

    const formatCurrency = (amount: number, currency: string) => {
        const langCode = i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU';
        return new Intl.NumberFormat(langCode, { style: 'currency', currency }).format(amount);
    };

    const getStatusClass = (status: InvoiceStatus) => {
        switch (status) {
            case 'Paid': return 'status-paid';
            case 'Pending': return 'status-pending';
            case 'Overdue': return 'status-overdue';
            default: return '';
        }
    };

    const renderSortIcon = (field: SortField) => {
        const isActive = sortField === field;
        return (
            <span className={`sort-icon ${isActive ? 'active' : ''}`}>
                {isActive ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        );
    };

    if (filteredAndSortedInvoices.length === 0) {
        return (
            <div className="table-container empty-state">
                <h3>{t('table.emptyTitle')}</h3>
                <p>{t('table.emptyDesc')}</p>
            </div>
        );
    }

    return (
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th onClick={() => handleSort('id')}>
                            <div className="th-content">{t('table.id')} <span>{renderSortIcon('id')}</span></div>
                        </th>
                        <th onClick={() => handleSort('vendor')}>
                            <div className="th-content">{t('table.vendor')} <span>{renderSortIcon('vendor')}</span></div>
                        </th>
                        <th onClick={() => handleSort('dateCreated')}>
                            <div className="th-content">{t('table.created')} <span>{renderSortIcon('dateCreated')}</span></div>
                        </th>
                        <th onClick={() => handleSort('dueDate')}>
                            <div className="th-content">{t('table.dueDate')} <span>{renderSortIcon('dueDate')}</span></div>
                        </th>
                        <th onClick={() => handleSort('amount')}>
                            <div className="th-content">{t('table.amount')} <span>{renderSortIcon('amount')}</span></div>
                        </th>
                        <th onClick={() => handleSort('status')}>
                            <div className="th-content">{t('table.status')} <span>{renderSortIcon('status')}</span></div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAndSortedInvoices.map((invoice) => (
                        <tr key={invoice.id}>
                            <td className="invoice-id">{invoice.id}</td>
                            <td className="vendor-name">{invoice.vendor}</td>
                            <td>{formatDate(invoice.dateCreated)}</td>
                            <td>
                                <span style={{ color: invoice.status === 'Overdue' ? 'var(--status-overdue-text)' : 'inherit' }}>
                                    {formatDate(invoice.dueDate)}
                                </span>
                            </td>
                            <td className="amount">{formatCurrency(invoice.amount, invoice.currency)}</td>
                            <td>
                                <span className={`status-badge ${getStatusClass(invoice.status)}`}>
                                    {invoice.status === 'Paid' ? t('filters.paid') : invoice.status === 'Pending' ? t('filters.pending') : t('filters.overdue')}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
