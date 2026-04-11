import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Inject the git commit hash at build time so the running bundle can
// compare itself against the live /health endpoint and force a reload
// if it's stale. Railway exposes RAILWAY_GIT_COMMIT_SHA; local dev
// falls back to 'dev'.
const BUILD_COMMIT =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    'dev';

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'maskable-icon-512x512.png'],
      manifest: {
        name: 'Invoice-Tracker',
        short_name: 'Invoice-Tracker',
        description: 'Invoice Tracking and AI Assistant',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  base: './',
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // manualChunks pins specific libraries to specific chunk names.
        // Only list libraries that are STATICALLY imported from the
        // entrypoint — vite will preload named chunks, so putting a
        // dynamically-imported lib here costs bandwidth at boot for no
        // benefit. jspdf / jspdf-autotable / html2canvas / react-pdf /
        // pdfjs-dist are all only loaded when the user clicks an
        // export or view button, so they're let through to Vite's
        // auto-chunking (which creates dynamic chunks that are NOT
        // preloaded).
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
})
