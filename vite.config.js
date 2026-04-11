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
        manualChunks: {
          'pdf-viewer': ['react-pdf', 'pdfjs-dist'],
          'vendor-react': ['react', 'react-dom'],
          'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'pdf-export': ['jspdf', 'jspdf-autotable'],
          'html2canvas': ['html2canvas'],
          'i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
})
