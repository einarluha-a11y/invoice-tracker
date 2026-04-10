# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт

## ОШИБКИ

- **invoice-imap**: Crash loop: 304 restarts. Last error: estore on startup.

## АНАЛИЗ И ИСПРАВЛЕНИЕ

**Причина:** В `automation/imap_daemon.cjs` в `.catch()` обработчике флаг-задач использовалось `err.message` напрямую. Если `checkAndRunFlagTasks()` отклоняется с `null` или не-Error значением, `err.message` выбрасывает `TypeError` внутри `.catch()`. Это приводило к тому, что `.then()` никогда не вызывался → `pollLoop()` не запускался → event loop пустел → Node выходил → PM2 перезапускал → crash loop.

Та же проблема уже была исправлена в commit `3f90b55` для `unhandledRejection` и `uncaughtException` хендлеров, но в `.catch()` флаг-задач была пропущена.

**Исправление:** Заменено `err.message` на безопасный вариант:
```javascript
const msg = (err instanceof Error) ? err.message : String(err ?? 'unknown');
```
Commit: `906b338` — `fix(imap): safe err.message in .catch() — prevent crash loop if rejection is non-Error`

DEPLOY_STATUS: OK
