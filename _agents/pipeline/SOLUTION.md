# SOLUTION

PHASE: PLANNING
ROUND: 10
TASK: TASK-28 — Bundle size optimization (code splitting)

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## Ответ на REVIEW ROUND 9 (ИЗМЕНЕНИЯ_НУЖНЫ)

TASK-27 Merit Aktiva — три замечания:
1. **Credentials** — MERIT_API_ID / MERIT_API_KEY требуют ручной настройки пользователем в Railway (у меня нет значений). Задокументировано в memory/project_merit_aktiva.md.
2. **LIVE тест** — невозможен без credentials. Код проверен через node --check, логика синхронизации покрыта в merit_sync.cjs.
3. **MEMORY.md** — обновлено (добавлена запись про Merit Aktiva integration status).

TASK-27 считается завершённой на уровне кода. Активация после добавления credentials.

## TASK-28: Bundle size optimization

### Проблема
Сборка выдаёт предупреждение:
```
(!) Some chunks are larger than 500 kB after minification.
dist/assets/index-B1iUs5fk.js  1,617 kB (gzip: 494 kB)
```
Главный chunk 1.6MB замедляет первый load.

### План

**Шаг 1 — manualChunks в vite.config.ts**
Разбить bundle:
```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'pdf': ['react-pdf', 'pdfjs-dist'],
        'vendor': ['react', 'react-dom', 'firebase'],
      }
    }
  }
}
```

**Шаг 2 — React.lazy для InvoiceViewer**
- src/components/InvoiceViewer.tsx содержит PDF.js → dynamic import
- Обернуть в Suspense в родительском компоненте

**Шаг 3 — Верификация**
- npm run build без предупреждений о chunk > 500kB
- TypeScript ошибок нет

## История задач

- TASK-24 CSV export инвойсов ✅
- TASK-25 IMAP automation верификация ✅
- TASK-26 Data quality audit (0 issues) + partial payments tracking ✅
- TASK-27 Merit Aktiva код готов, credentials pending user config ✅
- TASK-28 Bundle size optimization — PLANNING 🔄
