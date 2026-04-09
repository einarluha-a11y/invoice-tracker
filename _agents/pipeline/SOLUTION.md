# SOLUTION

PHASE: WAITING
ROUND: 0
DEPLOY_STATUS: OK
TASK: все задачи выполнены — ожидаю новых заданий от Perplexity
AGENT_SYNC: 2026-04-09 — pipeline idle, merge conflict resolved, ожидаю новых задач

## ПОСЛЕДНЕЕ ИСПРАВЛЕНИЕ

**Симптом**: invoice-imap 683 рестарта, crash без ошибки, только startup-логи.

**Два дефекта (исправлены):**

### 1. Двойной вызов loadRateLimitsFromFirestore() — concurrent gRPC crash
imap_listener.cjs вызывал его на уровне модуля + явный await в imap_daemon.cjs → параллельный gRPC crash.
Фикс: module-level вызов удалён из imap_listener.cjs.

### 2. Нет .catch() на startup chain → event loop empty → тихий выход
checkAndRunFlagTasks() падал → pollLoop()/auditLoop() не запускались → Node завершался → PM2 рестарт → цикл.
Фикс: .catch(err => ...).then(async () => { pollLoop(); auditLoop(); }) в imap_daemon.cjs.

## РЕЗУЛЬТАТ
- node --check: OK
- Процесс стабилен, 0 новых рестартов
- REVIEW: ПРИНЯТО (ВЕРДИКТ: ПРИНЯТО)
