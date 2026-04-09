import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { Invoice, InvoiceStatus } from '../data/types';
import { authHeaders } from '../data/api';

const InvoicePdfViewer = React.lazy(() =>
    import('./InvoicePdfViewer').then(m => ({ default: m.InvoicePdfViewer }))
);
import './InvoiceTable.css';

interface InvoiceTableProps {
    invoices: Invoice[];
    searchTerm: string;
    statusFilter: InvoiceStatus | 'All' | 'Unpaid';
    startDate?: string;
    endDate?: string;
    dateFilterType?: 'created' | 'due';
    sortField: SortField;
    sortDirection: SortDirection;
    onSort: (field: SortField) => void;
    onEdit: (invoice: Invoice) => void;
    onDelete: (id: string) => void;
    onRestore?: (id: string) => void;
    showArchived?: boolean;
    companyName?: string;
    canEdit?: boolean;
}

export type SortField = keyof Invoice;
export type SortDirection = 'asc' | 'desc';

export function InvoiceTable({ invoices, searchTerm, statusFilter, startDate, endDate, dateFilterType = 'created', sortField, sortDirection, onSort, onEdit, onDelete, onRestore, showArchived = false, companyName, canEdit = true }: InvoiceTableProps) {
    const { t, i18n } = useTranslation();
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [visibleLimit, setVisibleLimit] = useState(100);
    const [isExportingPDF, setIsExportingPDF] = useState(false);
    const [viewingPdfUrl, setViewingPdfUrl] = useState<string | null>(null);
    // Repair button state: docId → 'idle' | 'loading' | 'ok' | 'error'
    const [repairState, setRepairState] = useState<Record<string, 'loading' | 'ok' | 'error'>>({});

    const handleRepair = async (invoice: Invoice) => {
        if (repairState[invoice.id] === 'loading') return;
        setRepairState(prev => ({ ...prev, [invoice.id]: 'loading' }));
        try {
            const apiBase = (import.meta as any).env?.VITE_API_URL || '';
            const res = await fetch(`${apiBase}/api/reprocess-invoice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...await authHeaders() },
                body: JSON.stringify({ docId: invoice.id }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || res.statusText);
            }
            setRepairState(prev => ({ ...prev, [invoice.id]: 'ok' }));
            // Reset to idle after 3 seconds — Firestore listener will update the row automatically
            setTimeout(() => setRepairState(prev => { const s = { ...prev }; delete s[invoice.id]; return s; }), 3000);
        } catch (err: any) {
            console.error('[Repair]', err.message);
            setRepairState(prev => ({ ...prev, [invoice.id]: 'error' }));
            setTimeout(() => setRepairState(prev => { const s = { ...prev }; delete s[invoice.id]; return s; }), 4000);
        }
    };

    const handleSort = (field: SortField) => {
        onSort(field);
    };

    const toggleRow = (id: string) => {
        const newSet = new Set(expandedRows);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedRows(newSet);
    };

    const handleSave = (url: string) => {
        window.open(url, '_blank');
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
                // Respect dateFilterType from parent: 'created' or 'due'
                const compareDate = dateFilterType === 'due' ? (invoice.dueDate || '') : invoice.dateCreated;
                if (startDate) {
                    matchesDate = compareDate >= startDate;
                }
                if (endDate) {
                    matchesDate = matchesDate && compareDate <= endDate;
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
    }, [invoices, searchTerm, statusFilter, startDate, endDate, dateFilterType, sortField, sortDirection]);

    // Reset pagination when search or filters change
    useEffect(() => {
        setVisibleLimit(100);
    }, [searchTerm, statusFilter, startDate, endDate, dateFilterType, sortField, sortDirection]);

    const formatDate = (dateString: string) => {
        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
        const langCode = i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU';
        return new Date(dateString).toLocaleDateString(langCode, options);
    };

    const formatCurrency = (amount: number | undefined | null, currency: string) => {
        if (amount == null || isNaN(amount as number)) return '—';
        const langCode = i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU';
        try {
            return new Intl.NumberFormat(langCode, { style: 'currency', currency }).format(amount);
        } catch (e) {
            return `${(amount as number).toFixed(2)} ${currency}`;
        }
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

    const handleExportCSV = () => {
        if (filteredAndSortedInvoices.length === 0) return;

        // Generate CSV header
        const headers = [
            t('table.vendor'),
            t('table.invoice_no'),
            t('table.created'),
            t('table.dueDate'),
            t('table.amount'),
            t('table.status')
        ];

        // Format data rows
        const rows = filteredAndSortedInvoices.map(inv => [
            `"${inv.vendor.replace(/"/g, '""')}"`,
            `"${(inv.invoiceId || '').replace(/"/g, '""')}"`,
            inv.dateCreated,
            inv.dueDate,
            inv.amount,
            inv.status === 'Paid' ? t('filters.paid') : inv.status === 'Pending' ? t('filters.pending') : t('filters.overdue')
        ]);

        const csvContent = [
            `"${t('appName')}"`,
            ...(companyName ? [`"${t('settingsPage.nameLabel').replace(' *', '')}", "${companyName.replace(/"/g, '""')}"`] : []),
            `"${t('table.created')}:", "${new Date().toLocaleDateString()}"`,
            "", // Empty line before data
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Add BOM for Excel UTF-8
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `invoices_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Release memory immediately after download triggered
    };

    const handleExportPDF = async () => {
        if (filteredAndSortedInvoices.length === 0 || isExportingPDF) return;
        setIsExportingPDF(true);
        const langCode = i18n.language === 'en' ? 'en-US' : i18n.language === 'et' ? 'et-EE' : 'ru-RU';
        try {
            const { generateInvoicesPDF } = await import('../lib/pdfExport');
            await generateInvoicesPDF(filteredAndSortedInvoices.filter(i => !i.archived), {
                companyName,
                startDate,
                endDate,
                statusFilter,
                locale: langCode,
            });
        } catch (error) {
            console.error('PDF Export failed:', error);
            alert(t('table.pdfExportError', 'PDF export failed. Please try again.'));
        } finally {
            setIsExportingPDF(false);
        }
    };

    if (filteredAndSortedInvoices.length === 0) {
        return (
            <div className="table-container empty-state">
                <h3>{showArchived ? t('table.emptyArchiveTitle', 'Archive is empty') : t('table.emptyTitle')}</h3>
                <p>{showArchived ? t('table.emptyArchiveDesc', 'No archived invoices.') : t('table.emptyDesc')}</p>
            </div>
        );
    }

    return (
        <div className="table-container">
            <div className="table-actions">
                <button onClick={handleExportCSV} className="btn-export">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="8" y1="13" x2="16" y2="13"></line>
                        <line x1="8" y1="17" x2="16" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    {t('table.exportCsv')}
                </button>
                <button onClick={handleExportPDF} className="btn-export" disabled={isExportingPDF}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <path d="M12 18v-6"></path>
                        <path d="M9 15l3 3 3-3"></path>
                    </svg>
                    {isExportingPDF ? t('loadingData') : t('table.exportPdf')}
                </button>
            </div>
            <div style={{ width: '100%', overflowX: 'hidden' }}>
                <table>
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('vendor')} style={{ width: '16%' }}>
                                <div className="th-content">{t('table.vendor')} <span>{renderSortIcon('vendor')}</span></div>
                            </th>
                            <th onClick={() => handleSort('invoiceId')} style={{ width: '11%' }}>
                                <div className="th-content">{t('table.invoice_no')} <span>{renderSortIcon('invoiceId')}</span></div>
                            </th>
                            <th onClick={() => handleSort('dateCreated')} style={{ width: '9%' }}>
                                <div className="th-content">{t('table.created')} <span>{renderSortIcon('dateCreated')}</span></div>
                            </th>
                            <th onClick={() => handleSort('dueDate')} style={{ width: '9%' }}>
                                <div className="th-content">{t('table.dueDate')} <span>{renderSortIcon('dueDate')}</span></div>
                            </th>
                            <th onClick={() => handleSort('amount')} style={{ width: '15%' }}>
                                <div className="th-content">{t('table.amount')} <span>{renderSortIcon('amount')}</span></div>
                            </th>
                            <th onClick={() => handleSort('status')} style={{ width: '11%' }}>
                                <div className="th-content">{t('table.status')} <span>{renderSortIcon('status')}</span></div>
                            </th>
                            <th style={{ width: '6%', textAlign: 'center' }}>
                                <div className="th-content">{t('invoiceDetails.merit')}</div>
                            </th>
                            <th style={{ width: '23%' }}>
                                <div className="th-content">{t('table.actions')}</div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAndSortedInvoices.slice(0, visibleLimit).map((invoice) => (
                            <React.Fragment key={invoice.id}>
                                <tr className={expandedRows.has(invoice.id) ? 'expanded-parent-row' : ''} style={invoice.archived ? { opacity: 0.6 } : undefined}>
                                    <td data-label={t('table.vendor')} className="vendor-name" style={{ fontWeight: 600 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); toggleRow(invoice.id); }} 
                                                className="btn-expand"
                                                title={t('invoiceDetails.expandDetails')}
                                            >
                                                {expandedRows.has(invoice.id) ? '▼' : '▶'}
                                            </button>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <span>{invoice.vendor}</span>
                                                {(invoice.supplierVat || invoice.supplierRegistration) && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                        {invoice.supplierVat && <span style={{ whiteSpace: 'nowrap' }}>{t('invoiceDetails.vatLabel')} {invoice.supplierVat}</span>}
                                                        {invoice.supplierRegistration && <span style={{ wordBreak: 'break-word', lineHeight: '1.2' }}>{t('invoiceDetails.regNo')} {invoice.supplierRegistration}</span>}
                                                        {invoice.enrichmentSource && (
                                                            <span style={{ color: '#28a745', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '2px' }} title={`Verified via: ${invoice.enrichmentSource}`}>🛡️ <span style={{fontSize: '0.7rem'}}>{t('invoiceDetails.govVerified')}</span></span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                <td data-label={t('table.invoice_no')} style={{ lineHeight: '1.4' }}>
                                    {invoice.invoiceId
                                        ? <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', wordBreak: 'break-all' }}>{invoice.invoiceId}</span>
                                        : <span style={{ opacity: 0.4 }}>—</span>
                                    }
                                </td>
                                <td data-label={t('table.created')}>{formatDate(invoice.dateCreated)}</td>
                                <td data-label={t('table.dueDate')}>
                                    <span style={{ color: invoice.status === 'Overdue' ? 'var(--status-overdue-text)' : 'inherit' }}>
                                        {formatDate(invoice.dueDate)}
                                    </span>
                                </td>
                                <td data-label={t('table.amount')} className="amount">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ fontWeight: 600 }}>{formatCurrency(invoice.amount, invoice.currency)}</span>
                                            {(invoice as any).mathMismatch && (
                                                <span
                                                    title={`Subtotal + Tax ≠ Amount — ${t('invoiceDetails.needsReview')}`}
                                                    style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 5px', borderRadius: '3px', background: '#fff3cd', color: '#856404', border: '1px solid #ffc107', cursor: 'help' }}
                                                >
                                                    ⚠ {t('invoiceDetails.mathError')}
                                                </span>
                                            )}
                                        </div>
                                        {invoice.subtotalAmount !== undefined && (
                                            <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                <span>{t('invoiceDetails.subtotal')} {formatCurrency(invoice.subtotalAmount, invoice.originalForeignCurrency || invoice.currency)}</span>
                                                {invoice.taxAmount !== undefined && <span>{t('invoiceDetails.tax')} {formatCurrency(invoice.taxAmount, invoice.originalForeignCurrency || invoice.currency)}</span>}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td data-label={t('table.status')}>
                                    {invoice.archived ? (
                                        <span style={{ whiteSpace: 'nowrap' }} className="status-badge">📦 {t('table.archiveTab', 'Archive')}</span>
                                    ) : (
                                        <span style={{ whiteSpace: 'nowrap' }} className={`status-badge ${getStatusClass(invoice.status)}`}>
                                            {invoice.status === 'Paid' ? t('filters.paid') : invoice.status === 'Pending' ? t('filters.pending') : t('filters.overdue')}
                                        </span>
                                    )}
                                </td>
                                <td data-label={t('invoiceDetails.merit')} style={{ textAlign: 'center', fontSize: '0.8rem' }}>
                                    {invoice.meritSyncedAt ? (
                                        <span title={`Synced: ${invoice.meritInvoiceId || '—'}`} style={{ color: '#4caf50', fontWeight: 700 }}>✓</span>
                                    ) : invoice.meritSyncError ? (
                                        <span title={invoice.meritSyncError} style={{ color: '#ff5252', fontWeight: 700, cursor: 'help' }}>⚠</span>
                                    ) : (
                                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                    )}
                                </td>
                                <td data-label={t('table.actions')}>
                                    <div className="action-buttons">
                                        {canEdit && <button
                                            onClick={() => onEdit(invoice)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.9, display: 'flex' }}
                                            title={t('invoiceDetails.edit')}
                                        >✎</button>}
                                        {canEdit && !showArchived && (
                                            <button
                                                onClick={() => onDelete(invoice.id)}
                                                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.8, display: 'flex' }}
                                                title={t('table.archiveBtn', 'Archive')}
                                            >📦</button>
                                        )}
                                        {canEdit && showArchived && onRestore && (
                                            <button
                                                onClick={() => onRestore(invoice.id)}
                                                style={{ background: 'transparent', border: 'none', color: '#4caf50', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.9, display: 'flex' }}
                                                title={t('table.restoreBtn', 'Restore')}
                                            >↩</button>
                                        )}
                                        {invoice.fileUrl && (
                                            <button
                                                onClick={() => setViewingPdfUrl(invoice.fileUrl!)}
                                                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', opacity: 0.9 }}
                                                title={t('invoiceDetails.viewDocument')}
                                            >
                                                <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                    <polyline points="14 2 14 8 20 8"></polyline>
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                            {expandedRows.has(invoice.id) && (
                                <tr className="expanded-child-row">
                                    <td colSpan={8} style={{ padding: 0, borderTop: 'none' }}>
                                        <div className="expanded-content">
                                            <div className="financial-summary">
                                                <span><strong>{t('invoiceDetails.subtotal')}</strong> {formatCurrency(invoice.subtotalAmount || 0, invoice.originalForeignCurrency || invoice.currency)}</span>
                                                <span><strong>{t('invoiceDetails.taxVat')}</strong> {formatCurrency(invoice.taxAmount || 0, invoice.originalForeignCurrency || invoice.currency)}</span>
                                                <span className="total-highlight"><strong>{t('invoiceDetails.total')}</strong> {formatCurrency(invoice.amount, invoice.currency)}</span>
                                            </div>
                                            {invoice.description && (
                                                <div style={{ padding: '8px 12px', marginBottom: '10px', color: 'var(--text-secondary)', fontSize: '0.9em', lineHeight: '1.4' }}>
                                                    {invoice.description}
                                                </div>
                                            )}
                                            {invoice.lineItems && invoice.lineItems.length > 0 ? (
                                                <table className="line-items-table">
                                                    <thead>
                                                        <tr>
                                                            <th>{t('invoiceDetails.itemDescription')}</th>
                                                            <th style={{ textAlign: 'right' }}>{t('invoiceDetails.itemAmount')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {invoice.lineItems.map((item, idx) => (
                                                            <tr key={idx}>
                                                                <td>{item.description}</td>
                                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.amount, invoice.currency)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            ) : (
                                                <div className="no-line-items">{t('invoiceDetails.noLineItems')}</div>
                                            )}
                                            { (invoice.supplierVat || invoice.supplierRegistration || invoice.viesValidation) && (
                                                <div className="compliance-audit" style={{ marginTop: '15px', padding: '15px', background: 'var(--bg-secondary)', borderRadius: '8px', borderLeft: '4px solid #1a73e8' }}>
                                                    <h4 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                                                        <span>🛡️</span> {t('invoiceDetails.complianceTitle')}
                                                    </h4>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                                                        {invoice.supplierVat && (
                                                            <div><strong style={{ color: 'var(--text-primary)' }}>{t('invoiceDetails.supplierVat')}</strong> {invoice.supplierVat}
                                                                {invoice.viesValidation && (
                                                                    <span style={{ marginLeft: '10px', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', background: invoice.viesValidation.isValid ? 'rgba(40,167,69,0.1)' : 'rgba(220,53,69,0.1)', color: invoice.viesValidation.isValid ? '#28a745' : '#dc3545', fontWeight: 600 }}>
                                                                        {invoice.viesValidation.isValid ? `${t('invoiceDetails.viesVerified')} ✅` : `${t('invoiceDetails.viesInvalid')} ❌`}
                                                                    </span>
                                                                )}
                                                                {invoice.enrichmentSource && (
                                                                    <span style={{ marginLeft: '10px', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', background: 'rgba(40,167,69,0.1)', color: '#28a745', fontWeight: 600 }}>
                                                                        {t('invoiceDetails.govVerified')} 🛡️ ({invoice.enrichmentSource})
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {invoice.supplierRegistration && <div><strong style={{ color: 'var(--text-primary)' }}>{t('invoiceDetails.regNo')}</strong> {invoice.supplierRegistration}</div>}
                                                        {invoice.paymentTerms && <div><strong style={{ color: 'var(--text-primary)' }}>{t('invoiceDetails.bankDetails')}</strong> {invoice.paymentTerms}</div>}
                                                        {invoice.viesValidation && invoice.viesValidation.name && (
                                                            <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-primary)' }}>{t('invoiceDetails.registeredEU')}</strong> {invoice.viesValidation.name}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
                </table>
                {visibleLimit < filteredAndSortedInvoices.length && (
                    <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                        <button 
                            onClick={() => setVisibleLimit(prev => prev + 100)} 
                            className="btn-secondary" 
                            style={{ padding: '0.8rem 2rem', fontWeight: 600, fontSize: '0.95rem', borderRadius: '50px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                        >
                            <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                            {t('table.loadMore', 'Load More Invoices')} ({Math.min(visibleLimit, filteredAndSortedInvoices.length)} / {filteredAndSortedInvoices.length})
                        </button>
                    </div>
                )}
            </div>

            {/* Universal Inline Viewer Modal */}
            {viewingPdfUrl && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 9999,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(5px)'
                }}>
                    <div style={{ width: '100%', maxWidth: '1000px', display: 'flex', justifyContent: 'flex-end', gap: '1rem', padding: '1rem' }}>
                        <button
                            onClick={() => handleSave(viewingPdfUrl)}
                            style={{ background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                            title={t('table.save', 'Save')}
                        >
                            <svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            {t('table.save', 'Save')}
                        </button>
                        <button
                            onClick={() => setViewingPdfUrl(null)}
                            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '50%', width: '40px', height: '40px', fontSize: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '1rem' }}
                            title={t('pdfViewer.closeViewer')}
                        >
                            &times;
                        </button>
                    </div>
                    <div style={{ width: '90%', height: '85vh', background: '#fff', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                        <Suspense fallback={<div style={{ color: '#888' }}>Loading PDF…</div>}>
                            <InvoicePdfViewer url={viewingPdfUrl} />
                        </Suspense>
                    </div>
                </div>
            )}
        </div>
    );
}
