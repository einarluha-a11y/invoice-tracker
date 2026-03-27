import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../firebase';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
    isFirebaseConfigured: boolean;
    authError: string | null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    signInWithGoogle: async () => { },
    logout: async () => { },
    isFirebaseConfigured: false,
    authError: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    // Allowed emails are loaded from VITE_ALLOWED_EMAILS env var (comma-separated).
    // Fallback list is kept for local dev only — override via .env.production for prod.
    const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || 'buhus2203@gmail.com,einar.luha@gmail.com,info@accountingresources.eu')
        .split(',')
        .map((e: string) => e.trim().toLowerCase())
        .filter(Boolean);

    useEffect(() => {
        if (!isFirebaseConfigured || !auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser && currentUser.email) {
                // Check if the user is in the allowlist
                if (ALLOWED_EMAILS.includes(currentUser.email.toLowerCase())) {
                    setUser(currentUser);
                    setAuthError(null);
                } else {
                    console.warn(`Access denied for email: ${currentUser.email}`);
                    await signOut(auth);
                    setUser(null);
                    setAuthError(`Доступ запрещен для ${currentUser.email}. Пожалуйста, используйте разрешенный аккаунт.`);
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signInWithGoogle = async () => {
        if (!auth || !googleProvider) return;
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            console.error("Error signing in with Google", error);
            throw error;
        }
    };

    const logout = async () => {
        if (!auth) return;
        try {
            await signOut(auth!);
        } catch (error) {
            console.error("Error signing out", error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout, isFirebaseConfigured, authError }}>
            {children}
        </AuthContext.Provider>
    );
};
