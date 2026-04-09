# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: все задачи из BACKLOG выполнены — ожидаю новых

## Последнее выполненное

**BUGFIX — crash loop imap_daemon (685 рестартов)**

Причина: `checkAndRunFlagTasks().then(...)` без `.catch()` → при любом rejection `pollLoop`/`auditLoop` не запускались → event loop пустел → Node завершался → PM2 рестартовал → цикл.

Исправление в `automation/imap_daemon.cjs`:
```js
checkAndRunFlagTasks()
    .catch(err => {
        console.error('[imap-daemon] ⚠️ Flag tasks failed (non-fatal):', err.message);
    })
    .then(async () => {
        await loadRateLimitsFromFirestore();
        pollLoop();
        auditLoop();
    });
```

- node --check: ✅ OK  
- commit: c4bfc34  

DEPLOY_STATUS: OK
