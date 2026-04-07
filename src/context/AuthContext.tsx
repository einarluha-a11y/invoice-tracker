import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { auth, googleProvider, isFirebaseConfigured, db } from '../firebase';

export interface Account {
    id: string;
    name: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signInWithGoogle: (accountId?: string) => Promise<void>;
    logout: () => Promise<void>;
    isFirebaseConfigured: boolean;
    authError: string | null;
    currentAccountId: string | null;
    userRole: 'master' | 'admin' | 'user' | null;
    isMaster: boolean;
    availableAccounts: Account[];
    selectAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    signInWithGoogle: async () => { },
    logout: async () => { },
    isFirebaseConfigured: false,
    authError: null,
    currentAccountId: null,
    userRole: null,
    isMaster: false,
    availableAccounts: [],
    selectAccount: () => { },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<'master' | 'admin' | 'user' | null>(null);
    const [isMaster, setIsMaster] = useState(false);
    const [availableAccounts, setAvailableAccounts] = useState<Account[]>([]);

    // Holds the accountId selected on the Login screen, used once on next auth state change
    const pendingAccountIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isFirebaseConfigured || !auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (!currentUser) {
                setUser(null);
                setCurrentAccountId(null);
                setUserRole(null);
                setIsMaster(false);
                setAvailableAccounts([]);
                setLoading(false);
                return;
            }

            try {
                // 1. Check master_users
                if (db) {
                    const masterDoc = await getDoc(doc(db, 'master_users', currentUser.uid));
                    if (masterDoc.exists()) {
                        const accountsSnap = await getDocs(collection(db, 'accounts'));
                        const accounts: Account[] = accountsSnap.docs.map(d => ({
                            id: d.id,
                            name: (d.data().name as string) || d.id,
                        }));
                        setAvailableAccounts(accounts);
                        setIsMaster(true);
                        setUserRole('master');
                        // Restore previously selected account for master
                        const saved = localStorage.getItem('masterSelectedAccount');
                        setCurrentAccountId(saved);
                        setUser(currentUser);
                        setAuthError(null);
                        setLoading(false);
                        return;
                    }
                }

                // 2. Regular user — get accountId from pending or localStorage
                const accountId = pendingAccountIdRef.current || localStorage.getItem('currentAccountId');
                pendingAccountIdRef.current = null;

                if (!accountId || !db) {
                    await signOut(auth!);
                    setUser(null);
                    setAuthError('Выберите аккаунт перед входом.');
                    setLoading(false);
                    return;
                }

                const userDoc = await getDoc(doc(db, 'accounts', accountId, 'users', currentUser.uid));
                if (userDoc.exists()) {
                    setUser(currentUser);
                    setCurrentAccountId(accountId);
                    setUserRole((userDoc.data().role as 'admin' | 'user') || 'user');
                    setIsMaster(false);
                    setAuthError(null);
                    localStorage.setItem('currentAccountId', accountId);
                } else {
                    await signOut(auth!);
                    setUser(null);
                    setCurrentAccountId(null);
                    setUserRole(null);
                    localStorage.removeItem('currentAccountId');
                    setAuthError('Нет доступа к аккаунту. Обратитесь к администратору.');
                }
            } catch (err) {
                console.error('Auth check error', err);
                setUser(null);
                setAuthError('Ошибка проверки доступа.');
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signInWithGoogle = async (accountId?: string) => {
        if (!auth || !googleProvider) return;
        pendingAccountIdRef.current = accountId || null;
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            console.error('Error signing in with Google', error);
            pendingAccountIdRef.current = null;
            throw error;
        }
    };

    const logout = async () => {
        if (!auth) return;
        pendingAccountIdRef.current = null;
        try {
            await signOut(auth);
            setUser(null);
            setCurrentAccountId(null);
            setUserRole(null);
            setIsMaster(false);
            setAvailableAccounts([]);
            localStorage.removeItem('currentAccountId');
            localStorage.removeItem('masterSelectedAccount');
        } catch (error) {
            console.error('Error signing out', error);
        }
    };

    const selectAccount = (accountId: string) => {
        setCurrentAccountId(accountId);
        localStorage.setItem('masterSelectedAccount', accountId);
    };

    return (
        <AuthContext.Provider value={{
            user, loading, signInWithGoogle, logout, isFirebaseConfigured, authError,
            currentAccountId, userRole, isMaster, availableAccounts, selectAccount,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
