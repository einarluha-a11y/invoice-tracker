# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: BUGFIX crash loop imap — завершено

## Что было исправлено

- **Причина:** `checkAndRunFlagTasks()` могла отклонить Promise → `.then()` не вызывался → `pollLoop`/`auditLoop` не запускались → event loop пустел → Node.js завершался → PM2 рестартил → crash loop
- **Исправление:** Добавлен `.catch()` перед `.then()` в `imap_daemon.cjs` — теперь циклы запускаются даже при ошибке flag tasks
- **node --check:** OK (imap_daemon.cjs, imap_listener.cjs)
- **PM2:** invoice-imap online, fix активен

DEPLOY_STATUS: OK
