/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY: string
    readonly VITE_FIREBASE_AUTH_DOMAIN: string
    readonly VITE_FIREBASE_PROJECT_ID: string
    readonly VITE_FIREBASE_STORAGE_BUCKET: string
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
    readonly VITE_FIREBASE_APP_ID: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Injected at build time via vite.config.js `define`. Holds the git
// commit SHA the bundle was built from so the running app can detect
// when it has gone stale against prod and force a reload.
declare const __BUILD_COMMIT__: string;
