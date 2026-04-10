# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: Watchdog баг-репорт — анализ crash loop invoice-imap

## АНАЛИЗ

**Watchdog-репорт был корректным, но стал неактуальным к моменту исполнения.**

Хронология:
1. Краш-луп произошёл (1060 рестартов) — реальная проблема
2. Фикс задеплоен в коммитах `3f90b55` + `8af1cd3` (за 17 сек до watchdog-репорта)
3. Watchdog-репорт создан пока деплой ещё шёл → SOLUTION.md перезаписан с DEPLOY_STATUS: pending
4. Текущее состояние: invoice-imap стабилен с 2026-04-10 04:58 UTC, 0 новых рестартов

**Первопричина краш-лупа (уже исправлено):**
- `imap_daemon.cjs`: `unhandledRejection` передавал non-Error объект → crash
- `error_reporter.cjs`: 1060 циклов → Firestore system_logs переполнилась → transaction too big → crash

**"Last error: estore on startup" — ложная тревога:**
- `getErrorLog()` читает stderr PM2; `console.warn` тоже идёт в stderr
- "[RateLimit] ⏳ Restored 1 active IMAP ban(s) from Firestore on startup." — нормальное сообщение
- `errLog.slice(-200)` обрезает начало → "estore on startup."

## РЕЗУЛЬТАТ

- Оба фикса в production (Railway 04:58 UTC)
- `node --check`: OK (imap_daemon, imap_listener, error_reporter, watchdog)
- invoice-imap: online, 0 новых рестартов

DEPLOY_STATUS: OK
