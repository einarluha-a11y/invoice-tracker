import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs } from 'firebase/firestore';
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

        let unsubscribe: (() => void) | null = null;

        const accountPath = `accounts/${currentAccountId}/companies`;

        // Check if account-specific companies exist; fallback to top-level if empty
        getDocs(collection(db, accountPath))
            .then(snap => {
                const usePath = snap.empty ? 'companies' : accountPath;
                activePathRef.current = usePath;

                unsubscribe = onSnapshot(collection(db!, usePath), snapshot => {
                    const fetched: Company[] = snapshot.docs.map(d => ({
                        id: d.id,
                        ...d.data(),
                    } as Company));
                    setCompanies(fetched);
                    setCompaniesLoading(false);
                    setCompaniesError(null);
                }, err => {
                    console.error('Error fetching companies:', err);
                    setCompaniesError('Failed to load companies securely.');
                    setCompaniesLoading(false);
                });
            })
            .catch(err => {
                console.error('Error checking account companies:', err);
                // Fallback to top-level on error
                activePathRef.current = 'companies';
                unsubscribe = onSnapshot(collection(db!, 'companies'), snapshot => {
                    const fetched: Company[] = snapshot.docs.map(d => ({
                        id: d.id,
                        ...d.data(),
                    } as Company));
                    setCompanies(fetched);
                    setCompaniesLoading(false);
                }, err2 => {
                    console.error('Error fetching companies (fallback):', err2);
                    setCompaniesError('Failed to load companies securely.');
                    setCompaniesLoading(false);
                });
            });

        return () => { if (unsubscribe) unsubscribe(); };
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
