import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import i18n from './i18n';
import { registerSW } from 'virtual:pwa-register';

// ── STALE SERVICE WORKER CLEANUP ────────────────────────────────────────────
// The app used to live on invoice-tracker-blue.vercel.app and
// einarluha-a11y.github.io/invoice-tracker before it was consolidated onto
// Railway. PWAs installed from those origins registered service workers with
// precache manifests pointing at absolute URLs under the old host. When the
// user reopens such a PWA today, the old SW intercepts fetches and resolves
// e.g. `pdf.worker.min.mjs` against the old origin — which now 404s. The
// most visible symptom is the react-pdf error "Failed to fetch dynamically
// imported module: https://invoice-tracker-blue.vercel.app/assets/..."
//
// This block runs on every app start and:
//   1. Enumerates all registered service workers in this origin
//   2. Unregisters any whose script URL origin does not match the current
//      window origin (cross-origin leftovers from the old hosts)
//   3. Clears all caches whose name contains old-host keywords
//   4. If anything was cleaned up, forces a single reload so the fresh bundle
//      loads without the stale worker in the middle
//
// Idempotent — once the stale SW is gone, the subsequent boots skip the
// cleanup step.
const OLD_HOST_KEYWORDS = ['vercel.app', 'github.io', 'invoice-tracker-blue'];

async function cleanupStaleServiceWorkers(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) return false;
    let cleaned = false;
    try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
            const scriptUrl = (reg.active || reg.installing || reg.waiting)?.scriptURL || '';
            const scope = reg.scope || '';
            const isCrossOrigin = scriptUrl && !scriptUrl.startsWith(window.location.origin);
            const mentionsOldHost = OLD_HOST_KEYWORDS.some(k => scriptUrl.includes(k) || scope.includes(k));
            if (isCrossOrigin || mentionsOldHost) {
                console.warn(`[SW cleanup] Unregistering stale worker: ${scriptUrl || scope}`);
                try { await reg.unregister(); cleaned = true; } catch { /* ignore */ }
            }
        }
    } catch (err) {
        console.warn('[SW cleanup] getRegistrations failed:', err);
    }

    // Clear any caches that look like they belong to old origins
    if ('caches' in window) {
        try {
            const names = await caches.keys();
            for (const name of names) {
                if (OLD_HOST_KEYWORDS.some(k => name.includes(k))) {
                    console.warn(`[SW cleanup] Deleting stale cache: ${name}`);
                    await caches.delete(name);
                    cleaned = true;
                }
            }
        } catch (err) {
            console.warn('[SW cleanup] caches.keys failed:', err);
        }
    }

    return cleaned;
}

// ── CANONICAL DOMAIN REDIRECT ───────────────────────────────────────────────
// If this bundle is ever loaded from an old host (vercel.app, github.io,
// custom domain aliases), redirect to the single source of truth. This
// protects against stale PWAs, stale bookmarks, and typos. We only redirect
// when hostname matches a known old host — we do NOT redirect when running
// on localhost (dev) or on the canonical URL itself. The redirect preserves
// pathname + hash so deep links still land on the right page.
const CANONICAL_HOST = 'invoice-tracker-backend-production.up.railway.app';
const OLD_HOST_MATCHERS = [
    /\.vercel\.app$/,
    /\.github\.io$/,
    /invoice-tracker-blue/,
];
function redirectToCanonicalIfNeeded(): boolean {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    if (host === CANONICAL_HOST) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return false;
    const matchesOld = OLD_HOST_MATCHERS.some(re => re.test(host));
    if (!matchesOld) return false;
    const target = `https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
    console.warn(`[canonical redirect] ${host} → ${CANONICAL_HOST}`);
    window.location.replace(target);
    return true;
}

// Run cleanup + canonical redirect before registering the new SW. If anything
// stale was removed, reload once so the page loads a fresh bundle without
// any old worker in the middle. Guard against reload loops via sessionStorage.
(async () => {
    if (redirectToCanonicalIfNeeded()) return;
    const RELOAD_KEY = 'sw-cleanup-reloaded';
    const cleaned = await cleanupStaleServiceWorkers();
    if (cleaned && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        console.warn('[SW cleanup] Reloading once to apply fresh bundle.');
        window.location.reload();
        return;
    }
})();

// Register service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    // A new update was found. We do NOT forcefully reload here to avoid
    // interrupting the user every time a background push happens. They
    // will pick up the new version on the next natural page load.
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
