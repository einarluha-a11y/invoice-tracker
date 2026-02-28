import Papa from 'papaparse';
import { Invoice, InvoiceStatus } from './mockInvoices';

export interface RawInvoiceRow {
    id: string;
    vendor: string;
    amount: string;
    currency: string;
    datecreated: string;
    duedate: string;
    status: string;
}

// Убрана жесткая привязка к .env
// Конфигурация теперь управляется через src/config.ts

export const parseStatus = (rawStatus: string): InvoiceStatus => {
    const normalized = rawStatus.toLowerCase().trim();
    if (normalized === 'paid' || normalized === 'оплачен') return 'Paid';
    if (normalized === 'overdue' || normalized === 'просрочен') return 'Overdue';
    return 'Pending';
};

export const parseAmount = (rawAmount: string): number => {
    if (!rawAmount) return 0;
    // Убираем все символы кроме цифр, точек и запятых, затем меняем запятую на точку для Float
    const cleanStr = rawAmount.replace(/[^\d.,-]/g, '').replace(',', '.');
    const amount = parseFloat(cleanStr);
    return isNaN(amount) ? 0 : amount;
};

export const parseDate = (rawDate: string): string => {
    if (!rawDate) return new Date().toISOString();

    const cleanDate = rawDate.trim();

    // Check for DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY formats
    const euroPattern = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
    const match = cleanDate.match(euroPattern);

    if (match) {
        const [, day, month, year] = match;
        const paddedMonth = month.padStart(2, '0');
        const paddedDay = day.padStart(2, '0');
        return `${year}-${paddedMonth}-${paddedDay}`; // ISO format YYYY-MM-DD
    }

    // Check for YYYY-MM-DD or other formats that JS can parse natively
    const fallbackDate = new Date(cleanDate);
    if (!isNaN(fallbackDate.getTime())) {
        return cleanDate;
    }

    return new Date().toISOString();
};

export const fetchInvoices = async (url: string): Promise<Invoice[]> => {
    if (!url) {
        console.warn("No CSV URL provided. Falling back to empty data.");
        return [];
    }

    return new Promise((resolve, reject) => {
        Papa.parse<RawInvoiceRow>(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.toLowerCase().trim(),
            complete: (results) => {
                try {
                    const formattedData: Invoice[] = results.data.map((row) => ({
                        id: row.id || `UNK-${Math.random().toString(36).slice(2, 6)}`,
                        vendor: row.vendor || 'Unknown Vendor',
                        amount: parseAmount(row.amount),
                        currency: row.currency || 'USD',
                        dateCreated: parseDate(row.datecreated),
                        dueDate: parseDate(row.duedate),
                        status: parseStatus(row.status || ''),
                    }));
                    resolve(formattedData);
                } catch (err) {
                    console.error("Error formatting CSV data:", err);
                    reject(err);
                }
            },
            error: (error) => {
                console.error("Error parsing CSV:", error);
                reject(error);
            }
        });
    });
};
