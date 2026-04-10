# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: Watchdog баг-репорт — crash loop invoice-imap

## ВЫВОД

Краш-луп invoice-imap (1060 рестартов) **уже исправлен** до запуска агента.

**Первопричина (закрыто в 3f90b55 + 8af1cd3):**
- `imap_daemon.cjs`: `unhandledRejection` с non-Error → crash
- `error_reporter.cjs`: 1060 записей → Firestore transaction too big → cascade crash

**"estore on startup" — ложная тревога:** getErrorLog читает stderr; console.warn тоже идёт в stderr. "[RateLimit] ⏳ Restored..." — нормальная строка, slice(-200) обрезает начало.

**Итог:** invoice-imap онлайн, 0 новых рестартов с 04:58 UTC. node --check: OK.

DEPLOY_STATUS: OK
