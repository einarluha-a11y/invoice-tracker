# SOLUTION

PHASE: WAITING
ROUND: 0
DEPLOY_STATUS: OK
TASK: все задачи выполнены — ожидаю новых заданий от Einar/Perplexity

## ПОСЛЕДНЕЕ ИСПРАВЛЕНИЕ

**Симптом**: invoice-imap crash loop — 683 рестарта, тихий выход без ошибки.

**Два дефекта (исправлены):**

### 1. Двойной вызов loadRateLimitsFromFirestore()
imap_listener.cjs вызывал на уровне модуля + явный await в imap_daemon.cjs → concurrent gRPC crash.
Фикс: module-level вызов удалён из imap_listener.cjs.

### 2. Нет .catch() на startup chain → event loop empty → тихий выход
checkAndRunFlagTasks() падал → pollLoop()/auditLoop() не запускались → Node завершался → PM2 рестарт → цикл.
Фикс: .catch(err => ...).then(async () => { pollLoop(); auditLoop(); }) в imap_daemon.cjs.

## РЕЗУЛЬТАТ
- node --check: OK
- Процесс стабилен, 0 новых рестартов
- REVIEW раунд 0: ПРИНЯТО (ВЕРДИКТ: ПРИНЯТО)
- STATUS.md обновлён
