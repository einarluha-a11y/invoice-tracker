import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import i18n from './i18n';
import { registerSW } from 'virtual:pwa-register';

// Register service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    // A new update was found on Vercel. 
    // We do NOT forcefully reload the page here anymore to prevent 
    // interrupting the CEO's work every time a background push happens.
    console.log('New app version available. Refresh the window to apply.');
  },
  onOfflineReady() {
    console.log('App is ready for offline use.');
  },
});
// Sync HTML lang attribute with active i18next language for native browser input localization
document.documentElement.lang = i18n.language;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
