# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-08 — ### TASK-08
**Dropbox прямая интеграция** (выполнять только после получения токенов от Einar)

Заменить Zapier на прямой Dropbox API:
- `automation/dropbox_service.cjs` — загрузка PDF в Dropbox
- Автоматическое создание папок по структуре компании
- Логирование dropboxPath в Firestore
- Убрать Zapier webhook из imap_daemon.cjs

## ЗАДАНИЕ

**Claude, выполни следующие шаги последовательно:**

### 1. Создай `automation/dropbox_service.cjs`
