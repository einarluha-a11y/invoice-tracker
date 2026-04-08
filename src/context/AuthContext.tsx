import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
    User, onAuthStateChanged, signInWithPopup, signOut,
    createUserWithEmailAndPassword, signInWithEmailAndPassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, isFirebaseConfigured, db } from '../firebase';

export interface Account {
    id: string;
    name: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signInWithGoogle: (companyName?: string) => Promise<void>;
    registerWithEmail: (companyName: string, email: string, password: string) => Promise<void>;
    signInWithEmail: (companyName: string, email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    verifyMasterPassword: (password: string) => Promise<boolean>;
    isFirebaseConfigured: boolean;
    authError: string | null;
    currentAccountId: string | null;
    userRole: 'master' | 'admin' | 'user' | null;
    isMaster: boolean;
    masterPasswordVerified: boolean;
    availableAccounts: Account[];
    selectAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    signInWithGoogle: async () => { },
    registerWithEmail: async () => { },
    signInWithEmail: async () => { },
    logout: async () => { },
    verifyMasterPassword: async () => false,
    isFirebaseConfigured: false,
    authError: null,
    currentAccountId: null,
    userRole: null,
    isMaster: false,
    masterPasswordVerified: false,
    availableAccounts: [],
    selectAccount: () => { },
});

export const useAuth = () => useContext(AuthContext);

// Helper: resolve company name to account ID
async function resolveCompanyName(companyName: string): Promise<string | null> {
    if (!db) return null;
    const accountsSnap = await getDocs(collection(db, 'accounts'));
    for (const accDoc of accountsSnap.docs) {
        if ((accDoc.data().name as string)?.toLowerCase() === companyName.toLowerCase()) {
            return accDoc.id;
        }
    }
    return null;
}

// Helper: SHA-256 hash
async function sha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<'master' | 'admin' | 'user' | null>(null);
    const [isMaster, setIsMaster] = useState(false);
    const [masterPasswordVerified, setMasterPasswordVerified] = useState(false);
    const [availableAccounts, setAvailableAccounts] = useState<Account[]>([]);

    // Refs for pending operations (set before auth triggers onAuthStateChanged)
    const pendingAccountIdRef = useRef<string | null>(null);
    const pendingCompanyNameRef = useRef<string | null>(null);
    const pendingRegistrationRef = useRef<{ companyName: string } | null>(null);

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
                setMasterPasswordVerified(false);
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
                        setMasterPasswordVerified(false);
                        const saved = localStorage.getItem('masterSelectedAccount');
                        setCurrentAccountId(saved);
                        setUser(currentUser);
                        setAuthError(null);
                        setLoading(false);
                        return;
                    }
                }

                // 2. Handle pending registration (new user just created via email/password)
                if (pendingRegistrationRef.current && db) {
                    const { companyName } = pendingRegistrationRef.current;
                    pendingRegistrationRef.current = null;

                    // Find or create account
                    let accountId = await resolveCompanyName(companyName);
                    let isNewAccount = false;

                    if (!accountId) {
                        const newAccRef = doc(collection(db, 'accounts'));
                        await setDoc(newAccRef, { name: companyName, createdAt: serverTimestamp() });
                        accountId = newAccRef.id;
                        isNewAccount = true;
                    }

                    // Create user doc
                    await setDoc(doc(db, 'accounts', accountId, 'users', currentUser.uid), {
                        email: currentUser.email,
                        role: isNewAccount ? 'admin' : 'user',
                        createdAt: serverTimestamp(),
                    });

                    setUser(currentUser);
                    setCurrentAccountId(accountId);
                    setUserRole(isNewAccount ? 'admin' : 'user');
                    setIsMaster(false);
                    setAuthError(null);
                    localStorage.setItem('currentAccountId', accountId);
                    setLoading(false);
                    return;
                }

                // 3. Regular user — resolve accountId
                let accountId = pendingAccountIdRef.current || localStorage.getItem('currentAccountId');
                pendingAccountIdRef.current = null;

                // If we have a pending company name (email login or Google login with company name), resolve it
                if (!accountId && pendingCompanyNameRef.current && db) {
                    const companyName = pendingCompanyNameRef.current;
                    pendingCompanyNameRef.current = null;
                    accountId = await resolveCompanyName(companyName);
                }

                if (!accountId || !db) {
                    await signOut(auth!);
                    setUser(null);
                    setAuthError('login.selectAccountError');
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
                    setAuthError('login.noAccess');
                }
            } catch (err) {
                console.error('Auth check error', err);
                setUser(null);
                setAuthError('login.authCheckError');
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signInWithGoogle = async (companyName?: string) => {
        if (!auth || !googleProvider) return;
        if (companyName) {
            pendingCompanyNameRef.current = companyName;
        }
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            pendingCompanyNameRef.current = null;
            throw error;
        }
    };

    const registerWithEmail = async (companyName: string, email: string, password: string) => {
        if (!auth) return;
        pendingRegistrationRef.current = { companyName };
        try {
            await createUserWithEmailAndPassword(auth, email, password);
        } catch (error) {
            pendingRegistrationRef.current = null;
            throw error;
        }
    };

    const signInWithEmail = async (companyName: string, email: string, password: string) => {
        if (!auth) return;
        pendingCompanyNameRef.current = companyName;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            pendingCompanyNameRef.current = null;
            throw error;
        }
    };

    const verifyMasterPassword = async (password: string): Promise<boolean> => {
        if (!db) return false;
        try {
            const configDoc = await getDoc(doc(db, 'config', 'master_password'));
            if (!configDoc.exists()) return false;
            const storedHash = configDoc.data().hash as string;
            const inputHash = await sha256(password);
            if (inputHash === storedHash) {
                setMasterPasswordVerified(true);
                return true;
            }
            return false;
        } catch (err) {
            console.error('Master password verification failed', err);
            return false;
        }
    };

    const logout = async () => {
        if (!auth) return;
        pendingAccountIdRef.current = null;
        pendingCompanyNameRef.current = null;
        pendingRegistrationRef.current = null;
        try {
            await signOut(auth);
            setUser(null);
            setCurrentAccountId(null);
            setUserRole(null);
            setIsMaster(false);
            setMasterPasswordVerified(false);
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
            user, loading, signInWithGoogle, registerWithEmail, signInWithEmail,
            logout, verifyMasterPassword, isFirebaseConfigured, authError,
            currentAccountId, userRole, isMaster, masterPasswordVerified,
            availableAccounts, selectAccount,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
