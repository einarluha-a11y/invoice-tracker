import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import './Login.css';
import { useState } from 'react';

export function Login() {
    const { signInWithGoogle, isFirebaseConfigured } = useAuth();
    const { t, i18n } = useTranslation();
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        try {
            setError(null);
            setLoading(true);
            await signInWithGoogle();
        } catch (err: any) {
            console.error("Login failed:", err);
            setError(err.message || 'Error signing in. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="header-accent">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    Kontrol <span className="header-accent">Invoice</span>
                </h1>

                <p className="login-subtitle">
                    Secure access to your invoice dashboard. Please sign in with your Google account to continue.
                </p>

                {error && (
                    <div className="login-error">
                        {error}
                    </div>
                )}

                {!isFirebaseConfigured ? (
                    <div className="login-warning">
                        <strong>Firebase Not Configured</strong>
                        <p>Admin: Please follow setup instructions to configure Firebase Auth keys in the environment.</p>
                    </div>
                ) : (
                    <button
                        className="btn-google-login"
                        onClick={handleLogin}
                        disabled={loading}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        {loading ? 'Signing in...' : 'Sign in with Google'}
                    </button>
                )}

                <div className="login-footer">
                    <select
                        className="company-select"
                        style={{ margin: '0 auto', display: 'block' }}
                        value={i18n.language}
                        onChange={(e) => i18n.changeLanguage(e.target.value)}
                    >
                        <option value="ru">RU</option>
                        <option value="en">EN</option>
                        <option value="et">ET</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
