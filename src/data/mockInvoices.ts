export type InvoiceStatus = 'Pending' | 'Paid' | 'Overdue';

export interface Invoice {
    id: string;
    vendor: string;
    amount: number;
    currency: string;
    dateCreated: string;
    dueDate: string;
    status: InvoiceStatus;
}

export const mockInvoices: Invoice[] = [
    {
        id: 'INV-2023-001',
        vendor: 'Acme Corp',
        amount: 12500.00,
        currency: 'USD',
        dateCreated: '2023-10-01',
        dueDate: '2023-10-15',
        status: 'Paid',
    },
    {
        id: 'INV-2023-002',
        vendor: 'Global Tech Supplies',
        amount: 8400.50,
        currency: 'USD',
        dateCreated: '2023-10-10',
        dueDate: '2023-10-24',
        status: 'Pending',
    },
    {
        id: 'INV-2023-003',
        vendor: 'Creative Media Ltd',
        amount: 3200.00,
        currency: 'USD',
        dateCreated: '2023-09-15',
        dueDate: '2023-09-30',
        status: 'Overdue',
    },
    {
        id: 'INV-2023-004',
        vendor: 'Office Essentials',
        amount: 450.75,
        currency: 'USD',
        dateCreated: '2023-10-12',
        dueDate: '2023-10-26',
        status: 'Pending',
    },
    {
        id: 'INV-2023-005',
        vendor: 'ServerHost Inc',
        amount: 2100.00,
        currency: 'USD',
        dateCreated: '2023-08-01',
        dueDate: '2023-08-15',
        status: 'Paid',
    },
];
