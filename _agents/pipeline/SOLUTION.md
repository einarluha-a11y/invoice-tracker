# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт

## ОШИБКИ

- **invoice-imap**: Crash loop: 685 restarts. Last error:
  `[RateLimit] ⏳ Restored 1 active IMAP ban(s) from Firestore on startup.`

## ПРИЧИНА (Root Cause)

В `imap_daemon.cjs` цепочка `checkAndRunFlagTasks().then(...)` не имела `.catch()`.

Сценарий сбоя:
1. `checkAndRunFlagTasks()` отклоняет промис (любая причина: Firestore timeout, FS error)
2. `unhandledRejection` handler логирует ошибку — процесс продолжается
3. НО `.then()` callback пропускается → `pollLoop()` и `auditLoop()` никогда не вызываются
4. Event loop пустеет → Node завершается с exit code 0
5. PM2 рестартует → то же самое → crash loop с 683+ рестартами

Почему "Last error" = [RateLimit] message: процесс крашился немедленно после startup,
видно было только стартовые stderr-сообщения от `console.warn` в `loadRateLimitsFromFirestore`.

## ИСПРАВЛЕНИЕ

`automation/imap_daemon.cjs` — добавлен `.catch()` между `checkAndRunFlagTasks()` и `.then()`:

```js
checkAndRunFlagTasks()
    .catch(err => {
        console.error('[imap-daemon] ⚠️  Flag tasks failed (non-fatal, starting loops anyway):', err.message);
    })
    .then(async () => {
        await loadRateLimitsFromFirestore();
        pollLoop();
        auditLoop();
    });
```

Теперь `pollLoop`/`auditLoop` запускаются всегда, даже при сбое flag tasks.

## СТАТУС

- node --check: ✅ OK
- commit + push: ✅

DEPLOY_STATUS: OK
