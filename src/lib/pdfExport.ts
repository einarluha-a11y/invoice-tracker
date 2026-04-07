import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Invoice, InvoiceStatus } from '../data/types';

export interface PdfExportOptions {
    companyName?: string;
    startDate?: string;
    endDate?: string;
    statusFilter?: InvoiceStatus | 'All' | 'Unpaid';
    locale?: string;
}

const ROBOTO_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf';

async function loadRobotoBase64(): Promise<string> {
    const res = await fetch(ROBOTO_CDN);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function formatDatePdf(dateString: string, locale: string): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmountPdf(amount: number | undefined | null, currency: string, locale: string): string {
    if (amount == null || isNaN(amount)) return '—';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

function statusLabel(status: InvoiceStatus): string {
    const map: Record<InvoiceStatus, string> = { Paid: 'Paid', Pending: 'Pending', Overdue: 'Overdue' };
    return map[status] ?? status;
}

function buildPeriodLabel(startDate?: string, endDate?: string): string {
    if (!startDate && !endDate) return 'All periods';
    if (startDate && endDate) return `${startDate} — ${endDate}`;
    if (startDate) return `From ${startDate}`;
    return `Until ${endDate}`;
}

function filterLabel(statusFilter?: PdfExportOptions['statusFilter']): string {
    if (!statusFilter || statusFilter === 'All') return '';
    return ` · ${statusFilter}`;
}

export async function generateInvoicesPDF(invoices: Invoice[], options: PdfExportOptions = {}): Promise<void> {
    const { companyName, startDate, endDate, statusFilter, locale = 'en-US' } = options;

    const base64 = await loadRobotoBase64();
    const doc = new jsPDF();

    doc.addFileToVFS('Roboto-Regular.ttf', base64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'bold');
    doc.setFont('Roboto', 'normal');

    // Header
    doc.setFontSize(18);
    doc.text('Invoice Tracker', 14, 20);

    let y = 28;
    if (companyName) {
        doc.setFontSize(13);
        doc.setFont('Roboto', 'bold');
        doc.text(companyName, 14, y);
        doc.setFont('Roboto', 'normal');
        y += 7;
    }

    doc.setFontSize(10);
    doc.text(`Period: ${buildPeriodLabel(startDate, endDate)}${filterLabel(statusFilter)}`, 14, y);
    y += 6;
    doc.text(`Generated: ${new Date().toLocaleDateString(locale)}`, 14, y);
    y += 6;

    // Summary: count + totals per currency
    const totals: Record<string, number> = {};
    for (const inv of invoices) {
        totals[inv.currency] = (totals[inv.currency] ?? 0) + (inv.amount ?? 0);
    }
    const totalsStr = Object.entries(totals)
        .map(([cur, sum]) => formatAmountPdf(sum, cur, locale))
        .join('  |  ');
    doc.setFont('Roboto', 'bold');
    doc.text(`Total: ${invoices.length} invoices  ·  ${totalsStr || '0'}`, 14, y);
    doc.setFont('Roboto', 'normal');
    y += 8;

    // Table
    const head = [['#', 'Invoice No', 'Date', 'Due Date', 'Amount', 'Currency', 'Status', 'Vendor']];
    const body = invoices.map((inv, i) => [
        String(i + 1),
        inv.invoiceId || '—',
        formatDatePdf(inv.dateCreated, locale),
        formatDatePdf(inv.dueDate, locale),
        inv.amount != null ? inv.amount.toFixed(2) : '—',
        inv.currency,
        statusLabel(inv.status),
        inv.vendor,
    ]);

    autoTable(doc, {
        head,
        body,
        startY: y,
        styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 8 },
        headStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: [66, 133, 244] },
        columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 30 },
            2: { cellWidth: 22 },
            3: { cellWidth: 22 },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 14 },
            6: { cellWidth: 18 },
            7: { cellWidth: 'auto' },
        },
    });

    doc.save(`invoices_${new Date().toISOString().split('T')[0]}.pdf`);
}
