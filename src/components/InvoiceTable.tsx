import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Invoice, InvoiceStatus } from '../data/mockInvoices';
import { InvoicePdfViewer } from './InvoicePdfViewer';
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
    companyName?: string;
}

export type SortField = keyof Invoice;
export type SortDirection = 'asc' | 'desc';

export function InvoiceTable({ invoices, searchTerm, statusFilter, startDate, endDate, sortField, sortDirection, onSort, onEdit, onDelete, companyName }: InvoiceTableProps) {
    const { t, i18n } = useTranslation();
    const [isExportingPDF, setIsExportingPDF] = useState(false);
    const [viewingPdfUrl, setViewingPdfUrl] = useState<string | null>(null);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [isLoadingPdf, setIsLoadingPdf] = useState(false);

    useEffect(() => {
        let active = true;
        if (viewingPdfUrl && viewingPdfUrl.toLowerCase().includes('.pdf')) {
            setIsLoadingPdf(true);

            // Route through a free CORS proxy to bypass Firebase's strict bucket rules
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(viewingPdfUrl)}`;

            fetch(proxyUrl)
                .then(res => res.blob())
                .then(blob => {
                    if (active) {
                        const url = URL.createObjectURL(blob);
                        setPdfBlobUrl(url);
                        setIsLoadingPdf(false);
                    }
                })
                .catch(err => {
                    console.error('Failed to load PDF blob:', err);
                    setIsLoadingPdf(false);
                });
        } else {
            setPdfBlobUrl(null);
        }

        return () => {
            active = false;
            if (pdfBlobUrl) {
                URL.revokeObjectURL(pdfBlobUrl);
            }
        };
    }, [viewingPdfUrl]);

    const handleSort = (field: SortField) => {
        onSort(field);
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

    const handleExportCSV = () => {
        if (filteredAndSortedInvoices.length === 0) return;

        // Generate CSV header
        const headers = [
            t('table.vendor'),
            t('table.description'),
            t('table.created'),
            t('table.dueDate'),
            t('table.amount'),
            t('table.status')
        ];

        // Format data rows
        const rows = filteredAndSortedInvoices.map(inv => [
            `"${inv.vendor.replace(/"/g, '""')}"`,
            `"${(inv.invoiceId ? (inv.description && inv.description !== inv.invoiceId ? inv.invoiceId + ' / ' + inv.description : inv.invoiceId) : (inv.description || '')).replace(/"/g, '""')}"`,
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
    };

    const handleExportPDF = async () => {
        if (filteredAndSortedInvoices.length === 0 || isExportingPDF) return;
        setIsExportingPDF(true);

        try {
            const fontUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf';
            const response = await fetch(fontUrl);
            const blob = await response.blob();

            const base64data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve((reader.result as string).split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            const doc = new jsPDF();

            doc.addFileToVFS('Roboto-Regular.ttf', base64data);
            doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
            doc.addFont('Roboto-Regular.ttf', 'Roboto', 'bold'); // Prevents bold fallback to Helvetica
            doc.setFont('Roboto', 'normal');

            // Add Title
            doc.setFontSize(18);
            doc.text(t('appName'), 14, 22);

            let currentY = 30;
            if (companyName) {
                doc.setFontSize(14);
                doc.text(companyName, 14, currentY);
                currentY += 8;
            }

            doc.setFontSize(11);
            doc.text(`${t('table.created')}: ${new Date().toLocaleDateString()}`, 14, currentY);
            currentY += 10;

            const tableColumn = [
                t('table.vendor'),
                t('table.created'),
                t('table.dueDate'),
                t('table.amount'),
                t('table.status')
            ];

            const tableRows: any[] = [];

            filteredAndSortedInvoices.forEach(inv => {
                const rowData = [
                    inv.vendor,
                    inv.dateCreated,
                    inv.dueDate,
                    `${inv.amount} ${inv.currency}`,
                    inv.status === 'Paid' ? t('filters.paid') : inv.status === 'Pending' ? t('filters.pending') : t('filters.overdue')
                ];
                tableRows.push(rowData);
            });

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: currentY,
                styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 8 },
                headStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: [66, 133, 244] }
            });

            doc.save(`invoices_export_${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error("PDF Export failed:", error);
        } finally {
            setIsExportingPDF(false);
        }
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
            <div style={{ width: '100%', overflowX: 'auto' }}>
                <table>
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('vendor')} style={{ width: '18%' }}>
                                <div className="th-content">{t('table.vendor')} <span>{renderSortIcon('vendor')}</span></div>
                            </th>
                            <th onClick={() => handleSort('description')} style={{ width: '22%' }}>
                                <div className="th-content">{t('table.description')} <span>{renderSortIcon('description')}</span></div>
                            </th>
                            <th onClick={() => handleSort('dateCreated')} style={{ width: '12%' }}>
                                <div className="th-content">{t('table.created')} <span>{renderSortIcon('dateCreated')}</span></div>
                            </th>
                            <th onClick={() => handleSort('dueDate')} style={{ width: '12%' }}>
                                <div className="th-content">{t('table.dueDate')} <span>{renderSortIcon('dueDate')}</span></div>
                            </th>
                            <th onClick={() => handleSort('amount')} style={{ width: '12%' }}>
                                <div className="th-content">{t('table.amount')} <span>{renderSortIcon('amount')}</span></div>
                            </th>
                            <th onClick={() => handleSort('status')} style={{ width: '10%' }}>
                                <div className="th-content">{t('table.status')} <span>{renderSortIcon('status')}</span></div>
                            </th>
                            <th style={{ width: '14%', minWidth: '120px' }}>
                                <div className="th-content">{t('table.actions')}</div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAndSortedInvoices.map((invoice) => (
                            <tr key={invoice.id}>
                                <td data-label={t('table.vendor')} className="vendor-name" style={{ fontWeight: 600, maxWidth: '200px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                    {invoice.vendor}
                                </td>
                                <td data-label={t('table.description')} style={{ lineHeight: '1.4', maxWidth: '250px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                    {invoice.invoiceId && <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '2px', wordBreak: 'break-all' }}>{invoice.invoiceId}</div>}
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {invoice.description && invoice.description !== invoice.invoiceId ? invoice.description : (!invoice.invoiceId && <span style={{ opacity: 0.4 }}>—</span>)}
                                    </div>
                                </td>
                                <td data-label={t('table.created')}>{formatDate(invoice.dateCreated)}</td>
                                <td data-label={t('table.dueDate')}>
                                    <span style={{ color: invoice.status === 'Overdue' ? 'var(--status-overdue-text)' : 'inherit' }}>
                                        {formatDate(invoice.dueDate)}
                                    </span>
                                </td>
                                <td data-label={t('table.amount')} className="amount">{formatCurrency(invoice.amount, invoice.currency)}</td>
                                <td data-label={t('table.status')} style={{ minWidth: '150px' }}>
                                    <span style={{ whiteSpace: 'nowrap' }} className={`status-badge ${getStatusClass(invoice.status)}`}>
                                        {invoice.status === 'Paid' ? t('filters.paid') : invoice.status === 'Pending' ? t('filters.pending') : t('filters.overdue')}
                                    </span>
                                </td>
                                <td data-label={t('table.actions')}>
                                    <div className="action-buttons">
                                        <button
                                            onClick={() => onEdit(invoice)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.9, display: 'flex' }}
                                            title="Edit"
                                        >✎</button>
                                        <button
                                            onClick={() => onDelete(invoice.id)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', fontSize: '1.2rem', opacity: 0.8, display: 'flex' }}
                                            title="Delete"
                                        >🗑</button>
                                        {invoice.fileUrl && (
                                            <button
                                                onClick={() => setViewingPdfUrl(invoice.fileUrl!)}
                                                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', opacity: 0.9 }}
                                                title="View Document"
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
                        ))}
                    </tbody>
                </table>
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
                            title="Close Viewer"
                        >
                            &times;
                        </button>
                    </div>
                    {viewingPdfUrl.toLowerCase().includes('.pdf') ? (
                        <div style={{ width: '90%', height: '85vh', background: '#fff', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                            <InvoicePdfViewer url={viewingPdfUrl} />
                        </div>
                    ) : (
                        <div style={{ width: '90%', height: '85vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 'var(--radius-lg)' }}>
                            <img
                                src={viewingPdfUrl}
                                alt="Invoice Document"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--radius-lg)' }}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
