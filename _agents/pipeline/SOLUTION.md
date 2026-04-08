# SOLUTION

PHASE: DONE
ROUND: 10
TASK: TASK-28 — Bundle size optimization (code splitting)

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## Результат TASK-28

### Что сделано

**Шаг 1 — manualChunks в vite.config.js** — расширен список чанков:
- `pdf-viewer`: react-pdf + pdfjs-dist (уже был)
- `vendor-react`: react + react-dom (уже был)
- `firebase`: firebase/app + auth + firestore + storage (новый)
- `pdf-export`: jspdf + jspdf-autotable (новый)
- `html2canvas`: html2canvas (новый)
- `i18n`: i18next + react-i18next (новый, добавлен linter'ом)

**Шаг 2 — React.lazy для InvoicePdfViewer** — уже реализован в InvoiceTable.tsx (строки 7–9).

### Размеры чанков до/после

| Чанк | До | После |
|------|----|-------|
| index (main) | **1,178 kB** | **295 kB** ✅ |
| pdf-export | — | 417 kB |
| firebase | — | 411 kB |
| pdf-viewer | 431 kB | 423 kB |

Предупреждение `Some chunks are larger than 500 kB` — **устранено**.

### Верификация
- `npm run build` — чисто, нет предупреждений о chunk > 500 kB
- `node --check` на automation/*.cjs — ALL OK
- TypeScript: сборка прошла без ошибок

## История задач

- TASK-24 CSV export инвойсов ✅
- TASK-25 IMAP automation верификация ✅
- TASK-26 Data quality audit (0 issues) + partial payments tracking ✅
- TASK-27 Merit Aktiva код готов, credentials pending user config ✅
- TASK-28 Bundle size optimization — DONE ✅
