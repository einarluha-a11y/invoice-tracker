import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import i18n from './i18n';

// Sync HTML lang attribute with active i18next language for native browser input localization
document.documentElement.lang = i18n.language;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
