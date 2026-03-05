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
    sortField: SortField;
    sortDirection: SortDirection;
    onSort: (field: SortField) => void;
    onEdit: (invoice: Invoice) => void;
    onDelete: (id: string) => void;
}

export type SortField = keyof Invoice;
export type SortDirection = 'asc' | 'desc';

export function InvoiceTable({ invoices, searchTerm, statusFilter, startDate, endDate, sortField, sortDirection, onSort, onEdit, onDelete }: InvoiceTableProps) {
    const { t, i18n } = useTranslation();

    const handleSort = (field: SortField) => {
        onSort(field);
    };

    const filteredAndSortedInvoices = useMemo(() => {
        return invoices
            .filter((invoice) => {
                const matchesSearch = invoice.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    invoice.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (invoice.description && invoice.description.toLowerCase().includes(searchTerm.toLowerCase()));

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
                const aValRaw = a[sortField];
                const bValRaw = b[sortField];

                // Handle undefined fields (like description)
                const aValue = aValRaw !== undefined ? aValRaw : '';
                const bValue = bValRaw !== undefined ? bValRaw : '';

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
                        <th onClick={() => handleSort('vendor')}>
                            <div className="th-content">{t('table.vendor')} <span>{renderSortIcon('vendor')}</span></div>
                        </th>
                        <th onClick={() => handleSort('description')} style={{ width: '25%' }}>
                            <div className="th-content">{t('table.description')} <span>{renderSortIcon('description')}</span></div>
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
                        <th>
                            <div className="th-content">{t('table.actions')}</div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAndSortedInvoices.map((invoice) => (
                        <tr key={invoice.id}>
                            <td data-label={t('table.vendor')} className="vendor-name" style={{ fontWeight: 600 }}>{invoice.vendor}</td>
                            <td data-label={t('table.description')} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                {invoice.description || <span style={{ opacity: 0.4 }}>—</span>}
                            </td>
                            <td data-label={t('table.created')}>{formatDate(invoice.dateCreated)}</td>
                            <td data-label={t('table.dueDate')}>
                                <span style={{ color: invoice.status === 'Overdue' ? 'var(--status-overdue-text)' : 'inherit' }}>
                                    {formatDate(invoice.dueDate)}
                                </span>
                            </td>
                            <td data-label={t('table.amount')} className="amount">{formatCurrency(invoice.amount, invoice.currency)}</td>
                            <td data-label={t('table.status')}>
                                <span className={`status-badge ${getStatusClass(invoice.status)}`}>
                                    {invoice.status === 'Paid' ? t('filters.paid') : invoice.status === 'Pending' ? t('filters.pending') : t('filters.overdue')}
                                </span>
                            </td>
                            <td data-label={t('table.actions')}>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => onEdit(invoice)}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.9 }}
                                        title="Редактировать"
                                    >✎</button>
                                    <button
                                        onClick={() => onDelete(invoice.id)}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.8 }}
                                        title="Удалить"
                                    >🗑</button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
