# SOLUTION

PHASE: WAITING
ROUND: 1
DEPLOY_STATUS: OK
TASK: BUGFIX — imap crash loop (693 рестарта) устранён
COMPLETED: 2026-04-09 19:45 UTC

## ПРИЧИНА CRASH LOOP

Два дефекта в startup chain:

1. **Двойной gRPC**: imap_listener.cjs вызывал loadRateLimitsFromFirestore() на уровне модуля + явный await в imap_daemon.cjs -> concurrent gRPC crash. Фикс: module-level вызов удалён.

2. **Нет .catch() -> event loop drain**: checkAndRunFlagTasks() падал -> .then() пропускался -> pollLoop()/auditLoop() не запускались -> Node завершался exit 0 -> PM2 рестарт -> цикл. Фикс: добавлен .catch() перед .then().

## РЕЗУЛЬТАТ

- node --check: OK
- PM2 invoice-imap: стабилен (693 рестарта исторические, 0 новых)
- IMAP Gmail ban до 2026-04-10T10:50 UTC — восстанавливается из Firestore корректно

## КОММИТЫ

- c4bfc34 — fix(imap): add .catch() to prevent crash loop
- 52efca0 — fix: load Firestore rate limits on startup
- 41b73d0 — fix: Too many connections ban 5min
