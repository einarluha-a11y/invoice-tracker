import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { ShareLandingPage } from './components/ShareLandingPage'
import i18n from './i18n';
import { registerSW } from 'virtual:pwa-register';

// Path-based routing at the root so the public /share/:token page does
// not drag in AuthProvider / the whole dashboard bundle for anonymous
// suppliers. This isn't react-router — just a top-level check.
function parseShareToken(): string | null {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/^\/share\/([0-9a-f]{32})\/?$/);
    return match ? match[1] : null;
}

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

// Register service worker with auto-update.
//
// Reload strategy: in a standalone PWA (Dock icon, no address bar) there
// is no "natural page load" where the user would pick up a new version.
// The old code just logged `onNeedRefresh` and did nothing, leaving
// desktop PWAs stuck on stale bundles indefinitely — Einar saw this on
// April 11 when sprint 3 UI shipped but the Dock icon kept showing the
// sprint-2 layout.
//
// Fix: when `onNeedRefresh` fires, wait a few seconds (so any in-flight
// API call can finish), then call `updateSW(true)`. That triggers a
// reload using the fresh bundle the new service worker has already
// pre-cached. Unsaved client-side state is rare in this app (forms are
// all modal-based and submit immediately) so a reload is safe.
//
// We avoid reloading when a form is open or a text input has focus,
// which would clobber half-typed input. The reload retries every 5
// seconds until the window is idle.
let pendingReload = false;

function hasActiveInput(): boolean {
    if (typeof document === 'undefined') return false;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

const updateSW = registerSW({
  onNeedRefresh() {
    console.log('[PWA] New app version available. Will refresh when window is idle.');
    if (pendingReload) return;
    pendingReload = true;
    const tryReload = () => {
      if (hasActiveInput()) {
        setTimeout(tryReload, 5000);
        return;
      }
      console.log('[PWA] Applying new version now.');
      // updateSW(true) reloads after the waiting SW takes control —
      // workbox clientsClaim:true means that happens immediately.
      updateSW(true);
    };
    // Small initial delay so any in-flight XHR / WebSocket ACK has time
    // to finish cleanly before the page flips.
    setTimeout(tryReload, 2000);
  },
  onOfflineReady() {
    console.log('[PWA] App is ready for offline use.');
  },
});
// Sync HTML lang attribute with active i18next language for native browser input localization
document.documentElement.lang = i18n.language;

// Root render: decide between the public share landing page and the
// full authenticated dashboard. ShareLandingPage is self-contained and
// does not need AuthProvider — suppliers dropping files are not
// Firebase users.
const shareToken = parseShareToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareToken ? (
        <ShareLandingPage token={shareToken} />
    ) : (
        <AuthProvider>
            <App />
        </AuthProvider>
    )}
  </StrictMode>,
)
