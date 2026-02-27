import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

export interface Company {
    id: string; // Firestore document ID
    name: string;
    csvUrl: string;
    receivingEmail?: string;
}

export function useCompanies() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companiesLoading, setCompaniesLoading] = useState(true);
    const [companiesError, setCompaniesError] = useState<string | null>(null);

    useEffect(() => {
        if (!db) {
            setCompaniesLoading(false);
            setCompaniesError("Firestore is not initialized.");
            return;
        }

        const companiesRef = collection(db, 'companies');

        // Listen to real-time updates from the database
        const unsubscribe = onSnapshot(companiesRef, (snapshot) => {
            const fetchedCompanies: Company[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Company));

            setCompanies(fetchedCompanies);
            setCompaniesLoading(false);
            setCompaniesError(null);
        }, (err) => {
            console.error("Error fetching companies:", err);
            setCompaniesError("Failed to load companies securely.");
            setCompaniesLoading(false);
        });

        // Cleanup listener on unmount
        return () => unsubscribe();
    }, []);

    const addCompany = async (company: Omit<Company, 'id'>) => {
        if (!db) throw new Error("Database not connected");
        try {
            await addDoc(collection(db, 'companies'), company);
        } catch (err) {
            console.error("Error adding company:", err);
            throw err;
        }
    };

    const updateCompany = async (id: string, updates: Partial<Company>) => {
        if (!db) throw new Error("Database not connected");
        try {
            const companyRef = doc(db, 'companies', id);
            await updateDoc(companyRef, updates);
        } catch (err) {
            console.error("Error updating company:", err);
            throw err;
        }
    };

    const deleteCompany = async (id: string) => {
        if (!db) throw new Error("Database not connected");
        try {
            await deleteDoc(doc(db, 'companies', id));
        } catch (err) {
            console.error("Error deleting company:", err);
            throw err;
        }
    };

    return { companies, companiesLoading, companiesError, addCompany, updateCompany, deleteCompany };
}
