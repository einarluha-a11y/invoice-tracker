# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: invoice-imap crash loop — 1056 restarts

## АНАЛИЗ

**Первопричина**: `unhandledRejection` обработчик в `imap_daemon.cjs` передавал `reason` напрямую в `console.error`. В Node 18+ если reason — не стандартный объект, это могло вызвать повторный crash. Также: без `process.on('exit')` лога выход не фиксировался.

**Исправлено в `3f90b55`**: безопасное приведение reason/err к строке (`instanceof Error ? .message : String(reason ?? 'unknown')`), добавлен `process.on('exit')` лог.

**Дополнительно (`error_reporter.cjs`)**: при 1056 циклах ошибок коллекция `system_logs` разрослась → Firestore batch delete падал с "Transaction too big". Исправлено: обрезка сообщений до 4000 символов, `.select('createdAt')` при чтении старых записей, chunk 100 вместо 450, MAX 200 вместо 500.

## РЕЗУЛЬТАТ

- `imap_daemon.cjs`: stable с 2026-04-09 20:20 UTC, 0 новых рестартов
- `error_reporter.cjs`: Firestore write-safety улучшена
- `node --check`: OK

DEPLOY_STATUS: OK
