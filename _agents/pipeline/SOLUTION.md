# SOLUTION

PHASE: WAITING
ROUND: 0
DEPLOY_STATUS: OK
TASK: все задачи выполнены — ожидаю новых заданий

## ПОСЛЕДНЕЕ ИСПРАВЛЕНИЕ

**Симптом**: invoice-imap crash loop — 685 рестартов, тихий выход без ошибки.

**Два дефекта (исправлены):**

1. **Нет .catch() на startup chain → event loop empty → тихий выход**
   `checkAndRunFlagTasks()` падал → `.then()` не вызывался → `pollLoop()`/`auditLoop()` не стартовали → Node завершался с кодом 0 → PM2 перезапускал → цикл.
   **Фикс**: `.catch(err => ...).then(async () => { pollLoop(); auditLoop(); })` в `imap_daemon.cjs` (c4bfc34)

2. **Двойной вызов `loadRateLimitsFromFirestore()` — concurrent gRPC crash**
   `imap_listener.cjs` вызывал его на уровне модуля + явный `await` в `imap_daemon.cjs`.
   **Фикс**: module-level вызов удалён из `imap_listener.cjs` (e3a1441)

