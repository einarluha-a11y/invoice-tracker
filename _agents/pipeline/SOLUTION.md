# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт — crash loop invoice-imap

## АНАЛИЗ

**"Last error: estore on startup"** — не ошибка. `console.warn()` пишет в stderr, watchdog читает stderr и получает нормальное сообщение:
`[RateLimit] ⏳ Restored 1 active IMAP ban(s) from Firestore on startup.`
Последние 200 символов → обрезается до "...Firestore on startup." → "estore on startup."

**Реальная причина crash loop** (уже исправлена в предыдущих коммитах):
1. **`3f90b55`** — `imap_daemon.cjs`: небезопасное приведение `reason` в `unhandledRejection` обработчике → Node 18+ мог падать на нестандартных объектах. Исправлено: `instanceof Error ? .message : String(reason ?? 'unknown')`.
2. **`8af1cd3`** — `error_reporter.cjs`: после 1056 циклов падений коллекция `system_logs` разрослась → Firestore batch delete падал с "Transaction too big" → `reportError()` кидал исключение → следующий `unhandledRejection` → crash loop. Исправлено: обрезка сообщений до 4000 символов, `.select('createdAt')`, chunk 100.

**Почему watchdog подал ещё один репорт (211e492) ПОСЛЕ фикса?**
Фикс закоммичен в 07:54:11, watchdog запустил плановую проверку в 07:54:28 (через 17 секунд) — Railway ещё не задеплоил. Watchdog поймал "хвост" старого crash loop (delta +4 рестарта).

**Текущее состояние**: imap запущен нормально, 0 новых крашей. `node --check`: OK.

DEPLOY_STATUS: OK
