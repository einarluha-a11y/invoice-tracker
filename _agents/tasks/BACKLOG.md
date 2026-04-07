# BACKLOG — Invoice-Tracker Pipeline

## Выполнено сегодня (07.04.2026)
- ✅ TASK-01 — Фундамент multitenancy (accounts, master_users, migration)
- ✅ TASK-02 — Frontend (Login, AuthContext, useCompanies)
- ✅ TASK-03 — Backend auth middleware
- ✅ TASK-04 — Cleanup старого кода
- ✅ TASK-05 — Кэш правил + storage bucket
- ✅ TASK-06 — Рефакторинг updateInvoice()
- ✅ TASK-07 — Разбивка imap_daemon.cjs на 5 модулей
- ✅ TASK-08 — Users list endpoint

## Следующие задачи

### TASK-09
**Исправить race condition в perplexity_review.yml**
Добавить `git pull --rebase origin main` перед `git push` в шаге "Commit and push changes".
Файл: `.github/workflows/perplexity_review.yml`

### TASK-10
**Dropbox прямая интеграция** (ЖДЁТ credentials от Einar)
Заменить Zapier на прямой Dropbox API.
- `automation/dropbox_service.cjs`
- Автоматическое создание папок
- Убрать Zapier из imap_daemon.cjs

### TASK-11
**Merit Aktiva интеграция** (ЖДЁТ credentials от Einar)
Код готов — нужны реальные API ключи для тестирования.

## Правила
- Задания выполняются по порядку
- TASK-10 и TASK-11 пропускать пока нет credentials
- Если все задачи выполнены → PHASE: WAITING, не генерировать новые

