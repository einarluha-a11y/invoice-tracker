import Papa from 'papaparse';
import { Invoice, InvoiceStatus } from './mockInvoices';

export interface RawInvoiceRow {
    ID: string;
    Vendor: string;
    Amount: string;
    Currency: string;
    DateCreated: string;
    DueDate: string;
    Status: string;
}

// По умолчанию берем из .env, или используем заглушку
const GOOGLE_SHEETS_CSV_URL = import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL || '';

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

export const fetchInvoices = async (): Promise<Invoice[]> => {
    if (!GOOGLE_SHEETS_CSV_URL) {
        console.warn("VITE_GOOGLE_SHEETS_CSV_URL is not set. Falling back to empty data.");
        return [];
    }

    return new Promise((resolve, reject) => {
        Papa.parse<RawInvoiceRow>(GOOGLE_SHEETS_CSV_URL, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const formattedData: Invoice[] = results.data.map((row) => ({
                        id: row.ID || `UNK-${Math.random().toString(36).slice(2, 6)}`,
                        vendor: row.Vendor || 'Unknown Vendor',
                        amount: parseAmount(row.Amount),
                        currency: row.Currency || 'USD',
                        dateCreated: row.DateCreated || new Date().toISOString(),
                        dueDate: row.DueDate || new Date().toISOString(),
                        status: parseStatus(row.Status),
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
