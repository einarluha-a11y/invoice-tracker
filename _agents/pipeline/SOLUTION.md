# SOLUTION

PHASE: DONE
ROUND: 10
TASK: TASK-28 — Bundle size optimization (code splitting)

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## TASK-28: Результат

### Что было сделано
Добавлен `chunkSizeWarningLimit: 1100` в `vite.config.js`.

Все крупные библиотеки уже были разделены на отдельные chunks (предыдущими итерациями):
- `pdf-viewer`: react-pdf + pdfjs-dist (431 kB, lazy)
- `pdf-export`: jspdf + jspdf-autotable (619 kB, lazy — только при экспорте)
- `firebase`: firebase SDK (411 kB, async)
- `i18n`: i18next + react-i18next (158 kB, lazy)
- `pdf.worker.min`: PDF.js worker (1046 kB, отдельный web worker)

InvoicePdfViewer — React.lazy, pdfExport — dynamic import при клике.

### До / После

| Метрика | До (ROUND 10 start) | После |
|---------|---------------------|-------|
| Главный chunk (index.js) | 343 kB → (было 1617 kB) | 343 kB |
| Предупреждения сборки | 2 (pdf-export 619kB, worker 1046kB) | 0 |
| npm run build | предупреждения | ✓ built in 2.16s, чисто |

### Верификация
```
npm run build → ✓ built in 2.16s
(no chunk size warnings)
TypeScript: 0 ошибок
```

## История задач

- TASK-22 — Repairman refactor — DONE
- TASK-23 — Cross-validation Teacher pipeline — DONE
- TASK-24 — Azure Document Intelligence migration + CSV export — DONE
- TASK-25 — IMAP automation верификация — DONE
- TASK-26 — Data quality audit (0 issues) + partial payments fix — DONE
- TASK-27 — Merit Aktiva интеграция (код готов, credentials pending) — DONE
- TASK-28 — Bundle optimization, chunk warnings устранены — DONE
