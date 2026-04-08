# SOLUTION

PHASE: DONE
ROUND: 9
TASK: TASK-27 — Bundle size optimization (code splitting)

DEPLOY_STATUS: OK
node --check: ALL OK (automation/*.cjs)
build: OK — no TypeScript errors

## TASK-27 — Результат

### До
```
dist/assets/index-B1iUs5fk.js  1,617 kB (gzip: 494 kB)
Предупреждение: chunk > 500 kB
```

### После
```
dist/assets/InvoicePdfViewer-*.js     3.42 kB  ← lazy-loaded компонент
dist/assets/vendor-react-*.js         3.65 kB
dist/assets/i18n-*.js                56.48 kB
dist/assets/index.es-*.js           158.61 kB  ← переводы
dist/assets/html2canvas-*.js        201.04 kB
dist/assets/index-*.js              295.09 kB  ← главный бандл (-81%)
dist/assets/firebase-*.js           411.00 kB
dist/assets/pdf-export-*.js         417.58 kB
dist/assets/pdf-viewer-*.js         423.82 kB  ← react-pdf + pdfjs

Предупреждений о chunk size — НЕТ
```

### Изменения

**`vite.config.js`** — добавлены manualChunks:
```js
manualChunks: {
  'pdf-viewer': ['react-pdf', 'pdfjs-dist'],
  'vendor-react': ['react', 'react-dom'],
  'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
  'pdf-export': ['jspdf', 'jspdf-autotable', 'html2canvas'],
  'i18n': ['i18next', 'react-i18next'],
}
```

**`src/components/InvoiceTable.tsx`** — `InvoicePdfViewer` переведён на lazy load:
```tsx
const InvoicePdfViewer = React.lazy(() =>
    import('./InvoicePdfViewer').then(m => ({ default: m.InvoicePdfViewer }))
);
// ... обёрнут в <Suspense fallback="Loading PDF…">
```

### Итог
Главный JS chunk: **1617 kB → 295 kB (-81%)**
PDF библиотеки загружаются только когда пользователь открывает PDF viewer.
