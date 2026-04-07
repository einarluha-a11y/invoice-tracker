import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

export interface BankTransaction {
    id: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    reference: string;
    counterparty: string;
    account: string;
    source: string;
    companyId: string;
    matchedInvoiceId?: string;
    importedAt?: string;
}

/**
 * Subscribe to bank_transactions for a given company.
 * @param companyId  - Firestore companyId
 * @param source     - optional filter by source (e.g. 'merit_aktiva')
 */
export function useBankTransactions(companyId: string | undefined, source?: string) {
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!db || !companyId) {
            setTransactions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const constraints: any[] = [
            where('companyId', '==', companyId),
            orderBy('date', 'desc'),
        ];

        if (source) {
            constraints.splice(1, 0, where('source', '==', source));
        }

        const q = query(collection(db, 'bank_transactions'), ...constraints);

        const unsubscribe = onSnapshot(q, (snap) => {
            const rows: BankTransaction[] = snap.docs.map(d => ({
                id: d.id,
                date: d.data().date || '',
                amount: parseFloat(d.data().amount) || 0,
                currency: d.data().currency || 'EUR',
                description: d.data().description || '',
                reference: d.data().reference || '',
                counterparty: d.data().counterparty || '',
                account: d.data().account || '',
                source: d.data().source || '',
                companyId: d.data().companyId || '',
                matchedInvoiceId: d.data().matchedInvoiceId,
                importedAt: d.data().importedAt,
            }));
            setTransactions(rows);
            setLoading(false);
        }, (err) => {
            console.error('[useBankTransactions]', err);
            setError('Failed to load bank transactions');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [companyId, source]);

    return { transactions, loading, error };
}
