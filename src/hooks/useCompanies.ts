import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

export interface Company {
    id: string; // Firestore document ID
    name: string;
    emailAddress: string;
    // Optional IMAP settings
    imapHost?: string;
    imapUser?: string;
    imapPassword?: string;
    imapPort?: number;
    // Optional AI Rules
    customAiRules?: string;
}

export function useCompanies() {
    const { user, currentAccountId, isMaster, userRole } = useAuth();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companiesLoading, setCompaniesLoading] = useState(true);
    const [companiesError, setCompaniesError] = useState<string | null>(null);
    // Track which collection path is actually in use (for CRUD)
    const activePathRef = useRef<string>('companies');

    const canWrite = isMaster || userRole === 'admin';

    useEffect(() => {
        if (!db) {
            setCompaniesLoading(false);
            setCompaniesError('Firestore is not initialized.');
            return;
        }

        if (!user) {
            setCompaniesLoading(true);
            return;
        }

        if (!currentAccountId) {
            // Master hasn't selected an account yet, or no account resolved
            setCompanies([]);
            setCompaniesLoading(false);
            return;
        }

        setCompaniesLoading(true);
        setCompaniesError(null);
        setCompanies([]); // Clear stale data immediately so auto-select doesn't fire on old account's companies

        let unsubscribe: (() => void) | null = null;
        let cancelled = false; // Guard against stale callbacks after account switch

        const accountPath = `accounts/${currentAccountId}/companies`;
        activePathRef.current = accountPath;

        unsubscribe = onSnapshot(collection(db!, accountPath), snapshot => {
            if (cancelled) return;
            const fetched: Company[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            } as Company));
            setCompanies(fetched);
            setCompaniesLoading(false);
            setCompaniesError(null);
        }, err => {
            if (cancelled) return;
            console.error('Error fetching companies:', err);
            setCompaniesError('Failed to load companies securely.');
            setCompaniesLoading(false);
        });

        return () => {
            cancelled = true;
            if (unsubscribe) unsubscribe();
        };
    }, [user, currentAccountId]);

    const addCompany = async (company: Omit<Company, 'id'>) => {
        if (!db) throw new Error('Database not connected');
        if (!canWrite) throw new Error('Permission denied');
        try {
            await addDoc(collection(db, activePathRef.current), company);
        } catch (err) {
            console.error('Error adding company:', err);
            throw err;
        }
    };

    const updateCompany = async (id: string, updates: Partial<Company>) => {
        if (!db) throw new Error('Database not connected');
        if (!canWrite) throw new Error('Permission denied');
        try {
            await updateDoc(doc(db, activePathRef.current, id), updates);
        } catch (err) {
            console.error('Error updating company:', err);
            throw err;
        }
    };

    const deleteCompany = async (id: string) => {
        if (!db) throw new Error('Database not connected');
        if (!canWrite) throw new Error('Permission denied');
        try {
            await deleteDoc(doc(db, activePathRef.current, id));
        } catch (err) {
            console.error('Error deleting company:', err);
            throw err;
        }
    };

    return { companies, companiesLoading, companiesError, addCompany, updateCompany, deleteCompany };
}
