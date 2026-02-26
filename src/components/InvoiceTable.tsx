import { useState, useMemo } from 'react';
import { Invoice, InvoiceStatus } from '../data/mockInvoices';
import './InvoiceTable.css';

interface InvoiceTableProps {
    invoices: Invoice[];
    searchTerm: string;
    statusFilter: InvoiceStatus | 'All';
}

type SortField = keyof Invoice;
type SortDirection = 'asc' | 'desc';

export function InvoiceTable({ invoices, searchTerm, statusFilter }: InvoiceTableProps) {
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
                const matchesStatus = statusFilter === 'All' || invoice.status === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => {
                const aValue = a[sortField];
                const bValue = b[sortField];

                let comparison = 0;
                if (aValue > bValue) comparison = 1;
                if (aValue < bValue) comparison = -1;

                return sortDirection === 'asc' ? comparison : -comparison;
            });
    }, [invoices, searchTerm, statusFilter, sortField, sortDirection]);

    const formatDate = (dateString: string) => {
        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('ru-RU', options);
    };

    const formatCurrency = (amount: number, currency: string) => {
        return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(amount);
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
                <h3>Инвойсы не найдены</h3>
                <p>Попробуйте изменить параметры фильтрации.</p>
            </div>
        );
    }

    return (
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th onClick={() => handleSort('id')}>
                            <div className="th-content">ID <span>{renderSortIcon('id')}</span></div>
                        </th>
                        <th onClick={() => handleSort('vendor')}>
                            <div className="th-content">Поставщик <span>{renderSortIcon('vendor')}</span></div>
                        </th>
                        <th onClick={() => handleSort('dateCreated')}>
                            <div className="th-content">Создан <span>{renderSortIcon('dateCreated')}</span></div>
                        </th>
                        <th onClick={() => handleSort('dueDate')}>
                            <div className="th-content">Срок оплаты <span>{renderSortIcon('dueDate')}</span></div>
                        </th>
                        <th onClick={() => handleSort('amount')}>
                            <div className="th-content">Сумма <span>{renderSortIcon('amount')}</span></div>
                        </th>
                        <th onClick={() => handleSort('status')}>
                            <div className="th-content">Статус <span>{renderSortIcon('status')}</span></div>
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
                                    {invoice.status === 'Paid' ? 'Оплачен' : invoice.status === 'Pending' ? 'В ожидании' : 'Просрочен'}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
