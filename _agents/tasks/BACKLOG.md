# BACKLOG — Invoice-Tracker Pipeline

## ПРАВИЛО
- Все задания пишет только Perplexity вручную
- perplexity_review.py НЕ генерирует задания сам
- После выполнения → PHASE: WAITING
- Новое задание → Perplexity добавляет в BACKLOG и пишет в SOLUTION.md

---

## Выполнено

- ✅ TASK-01 — Фундамент multitenancy
- ✅ TASK-02 — Frontend (Login, AuthContext, useCompanies)
- ✅ TASK-03 — Backend auth middleware
- ✅ TASK-04 — Cleanup старого кода
- ✅ TASK-05 — Кэш правил + storage bucket
- ✅ TASK-06 — Рефакторинг updateInvoice()
- ✅ TASK-07 — Разбивка imap_daemon.cjs на 5 модулей
- ✅ TASK-08 — Users list endpoint
- ✅ TASK-09 — Race condition fix (git pull --rebase + concurrency)
- ✅ TASK-10 — Мягкое удаление инвойсов
- ✅ TASK-11 — PDF export рефакторинг
- ✅ TASK-12 — Dropbox интеграция активирована

---

## В очереди

### TASK-13 — В РАБОТЕ
Исправить 401 при открытии приложенных файлов к инвойсам
- InvoicePdfViewer.tsx — добавить Firebase Auth токен к fetch запросам
- api_server.cjs /api/pdf-proxy — использовать Admin SDK
- firebase storage.rules — allow read: if request.auth != null
- firebase deploy --only storage

### TASK-14
Отключить автогенерацию задач в perplexity_review.py
- После DEPLOY_STATUS: OK → писать только PHASE: WAITING
- Убрать логику BACKLOG reading и генерации следующего задания
- REVIEW.md содержит только ревью, без "next task"

---

## Ожидают credentials

- Merit Aktiva — нужны API ключи от Einar
- Revolut — отложено

