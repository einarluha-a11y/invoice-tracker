// Invoice domain types — extracted from mockInvoices.ts so that production
// components can import types without pulling mock data into the bundle.

export type InvoiceStatus = 'Pending' | 'Paid' | 'Overdue';

export interface Invoice {
    id: string;
    invoiceId?: string;
    vendor: string;
    description?: string;
    amount: number;
    currency: string;
    dateCreated: string;
    dueDate: string;
    status: InvoiceStatus;
    fileUrl?: string;
    subtotalAmount?: number;
    taxAmount?: number;
    lineItems?: Array<{ description: string; amount: number; }>;
    validationWarnings?: string[];
    supplierRegistration?: string;
    supplierVat?: string;
    receiverName?: string;
    receiverVat?: string;
    paymentTerms?: string;
    viesValidation?: { isValid: boolean; name: string | null; address: string | null; error: string | null; };
    enrichmentSource?: string;
    originalForeignCurrency?: string;
    originalForeignAmount?: number;
    // Merit Aktiva sync
    meritSyncedAt?: any;
    meritInvoiceId?: string;
    meritSyncError?: string;
    meritPaymentSyncedAt?: any;
    // Soft delete (archive)
    archived?: boolean;
    deletedAt?: any;
    // Phase 1 — Confidence + anomaly metadata (Scout/Teacher pipeline)
    confidenceScores?: Record<string, number>;
    minFieldConfidence?: number;
    avgFieldConfidence?: number;
    lowConfidenceFields?: string[];
    extractionQuality?: 'high' | 'medium' | 'low';
    anomalyScore?: number;
    anomalyReasons?: string[];
    anomalyZScore?: number;
    viesStatus?: 'valid' | 'invalid' | 'unverified';
    contentHash?: string;
    docIndex?: number;
    docCount?: number;
}
