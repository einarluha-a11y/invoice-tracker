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

**Код TASK-08 уже реализован и протестирован** (см. предыдущий аудит). Осталось только активировать интеграцию:

1. **Получить DROPBOX_ACCESS_TOKEN от Einar** — инструкция уже готова
2. **Добавить env переменную в Railway:**
