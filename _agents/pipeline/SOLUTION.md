# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-08 — ### TASK-08 ⏳ WAITING
**Dropbox прямая интеграция** (выполнять только после получения токенов от Einar)

Заменить Zapier на прямой Dropbox API:
- `automation/dropbox_service.cjs` — загрузка PDF в Dropbox
- Автоматическое создание папок по структуре компании
- Логирование dropboxPath в Firestore
- Убрать Zapier webhook из imap_daemon.cjs

## ЗАДАНИЕ

Claude должен выполнить следующие шаги:

1. **Создать `automation/dropbox_service.cjs`** — сервис для работы с Dropbox API:
