import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import './Login.css';
import { useState } from 'react';

type LoginView = 'login' | 'register' | 'master';

const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

export function Login() {
    const { signInWithGoogle, registerWithEmail, signInWithEmail, isFirebaseConfigured, authError } = useAuth();
    const { t, i18n } = useTranslation();

    const [view, setView] = useState<LoginView>('login');
    const [companyName, setCompanyName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Translate authError keys from AuthContext
    const displayError = authError
        ? (authError.startsWith('login.') || authError.startsWith('register.') || authError.startsWith('master.')
            ? t(authError)
            : authError)
        : localError;

    const handleEmailLogin = async () => {
        if (!companyName.trim()) { setLocalError(t('login.enterCompany')); return; }
        if (!email.trim()) { setLocalError(t('login.enterEmail')); return; }
        try {
            setLocalError(null);
            setLoading(true);
            await signInWithEmail(companyName.trim(), email.trim(), password);
        } catch (err: any) {
            setLocalError(err.code === 'auth/invalid-credential'
                ? t('login.invalidCredentials')
                : err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        if (!companyName.trim()) { setLocalError(t('login.enterCompany')); return; }
        try {
            setLocalError(null);
            setLoading(true);
            await signInWithGoogle(companyName.trim());
        } catch (err: any) {
            setLocalError(err.message || 'Error signing in.');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async () => {
        if (!companyName.trim()) { setLocalError(t('register.enterCompany')); return; }
        if (!email.trim()) { setLocalError(t('register.enterEmail')); return; }
        if (password.length < 6) { setLocalError(t('register.passwordTooShort')); return; }
        try {
            setLocalError(null);
            setLoading(true);
            await registerWithEmail(companyName.trim(), email.trim(), password);
        } catch (err: any) {
            setLocalError(err.code === 'auth/email-already-in-use'
                ? t('register.emailInUse')
                : err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMasterGoogle = async () => {
        try {
            setLocalError(null);
            setLoading(true);
            await signInWithGoogle();
        } catch (err: any) {
            setLocalError(err.message || 'Error signing in.');
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
        if (e.key === 'Enter') handler();
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
                    <span>Invoice-<span className="header-accent">Tracker</span></span>
                </h1>

                <p className="login-subtitle">
                    {view === 'register' ? t('register.subtitle') : view === 'master' ? t('master.subtitle') : t('login.subtitle')}
                </p>

                {displayError && (
                    <div className="login-error">{displayError}</div>
                )}

                {!isFirebaseConfigured ? (
                    <div className="login-warning">
                        <strong>{t('login.firebaseNotConfigured')}</strong>
                        <p>{t('login.firebaseSetup')}</p>
                    </div>
                ) : (
                    <>
                        {/* Tabs */}
                        <div className="login-tabs">
                            <button
                                className={`login-tab ${view === 'login' ? 'active' : ''}`}
                                onClick={() => { setView('login'); setLocalError(null); }}
                            >
                                {t('login.tabLogin')}
                            </button>
                            <button
                                className={`login-tab ${view === 'register' ? 'active' : ''}`}
                                onClick={() => { setView('register'); setLocalError(null); }}
                            >
                                {t('login.tabRegister')}
                            </button>
                            <button
                                className={`login-tab ${view === 'master' ? 'active' : ''}`}
                                onClick={() => { setView('master'); setLocalError(null); }}
                            >
                                {t('login.tabMaster')}
                            </button>
                        </div>

                        {/* LOGIN VIEW */}
                        {view === 'login' && (
                            <>
                                <input
                                    className="login-input"
                                    type="text"
                                    placeholder={t('login.companyPlaceholder')}
                                    value={companyName}
                                    onChange={e => setCompanyName(e.target.value)}
                                />
                                <input
                                    className="login-input"
                                    type="email"
                                    placeholder={t('login.emailPlaceholder')}
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                                <input
                                    className="login-input"
                                    type="password"
                                    placeholder={t('login.passwordPlaceholder')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    onKeyDown={e => handleKeyDown(e, handleEmailLogin)}
                                />
                                <button
                                    className="btn-login-primary"
                                    onClick={handleEmailLogin}
                                    disabled={loading}
                                >
                                    {loading ? t('login.signingIn') : t('login.signInBtn')}
                                </button>

                                <div className="login-divider">{t('login.or')}</div>

                                <button
                                    className="btn-google-login"
                                    onClick={handleGoogleLogin}
                                    disabled={loading}
                                >
                                    <GoogleIcon />
                                    {t('login.signInGoogle')}
                                </button>
                            </>
                        )}

                        {/* REGISTER VIEW */}
                        {view === 'register' && (
                            <>
                                <input
                                    className="login-input"
                                    type="text"
                                    placeholder={t('login.companyPlaceholder')}
                                    value={companyName}
                                    onChange={e => setCompanyName(e.target.value)}
                                />
                                <p className="login-helper">{t('register.companyHelp')}</p>
                                <input
                                    className="login-input"
                                    type="email"
                                    placeholder={t('login.emailPlaceholder')}
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                                <input
                                    className="login-input"
                                    type="password"
                                    placeholder={t('login.passwordPlaceholder')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    onKeyDown={e => handleKeyDown(e, handleRegister)}
                                />
                                <button
                                    className="btn-login-primary"
                                    onClick={handleRegister}
                                    disabled={loading}
                                >
                                    {loading ? t('register.creating') : t('register.createBtn')}
                                </button>
                            </>
                        )}

                        {/* MASTER VIEW */}
                        {view === 'master' && (
                            <>
                                <p className="master-step">{t('master.step1')}</p>
                                <button
                                    className="btn-google-login"
                                    onClick={handleMasterGoogle}
                                    disabled={loading}
                                >
                                    <GoogleIcon />
                                    {loading ? t('login.signingIn') : t('login.signInGoogle')}
                                </button>
                            </>
                        )}
                    </>
                )}

                <div className="login-footer">
                    <select
                        className="company-select"
                        style={{ margin: '0 auto', display: 'block' }}
                        value={i18n.language}
                        onChange={(e) => i18n.changeLanguage(e.target.value)}
                    >
                        <option value="et">ET</option>
                        <option value="en">EN</option>
                        <option value="ru">RU</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
