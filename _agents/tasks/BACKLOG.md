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
### TASK-15 — В РАБОТЕ
Убрать дублирующий dropdown переключения компании в хедере
- В хедере два dropdown рядом: аккаунт-switcher и компания-switcher
- Оставить только один — переключатель компании (useCompanies)
- Аккаунт-switcher показывать только мастер-пользователю когда у него несколько аккаунтов
- Для обычного пользователя с одним аккаунтом — убрать аккаунт-switcher полностью
### TASK-16 — СЛЕДУЮЩИЙ
Добавить concurrency group в perplexity_review.yml — навсегда закрыть race condition
Добавить после строки permissions:
```yaml
concurrency:
  group: perplexity-review
  cancel-in-progress: false
```
### TASK-19 — В РАБОТЕ
Полная ревизия кода — исправить все найденные проблемы:
1. merit_aktiva_agent.cjs — заменить собственный parseFloat на cleanNum (5 мест)
2. invoice_processor.cjs:80 — убрать захардкоженный IDEACOM_ID
3. reconcile_bank_statement.cjs:32 — убрать захардкоженный companyId
4. ecosystem.config.cjs — добавить max_restarts:10, restart_delay:5000
5. 127 console.log — заменить на console.error или убрать
6. Проверить entry point imap_daemon в ecosystem.config

### TASK-20 — ПРИОРИТЕТ №1
Заменить polling на GitHub Webhook — надёжная мгновенная связь Perplexity↔Claude CLI

Создать automation/webhook_receiver.cjs (Express сервер на порту 3001):
- Принимает POST /pipeline от GitHub
- Верифицирует подпись X-Hub-Signature-256
- При изменении SOLUTION.md — запускает Claude CLI немедленно через spawn
- Добавить в ecosystem.config.cjs как PM2 процесс "pipeline-webhook"

Настроить туннель через Cloudflare Tunnel (бесплатно, постоянный URL):
- Установить cloudflared если нет
- Создать туннель на localhost:3001
- Записать публичный URL в _agents/pipeline/WEBHOOK_URL.md

Настроить GitHub Webhook:
- URL: публичный URL туннеля + /pipeline
- Secret: сгенерировать случайную строку, сохранить в .env как WEBHOOK_SECRET
- Events: push (только)

Удалить pipeline_monitor.cjs поллинг после успешного тестирования.

### TASK-21 — СРОЧНО
Перепутаны инвойсы Global Technics и Ideacom на дашборде.
При выборе Global Technics показываются инвойсы Ideacom и наоборот.
Проверить маппинг accountId → companyId в:
- accounts/global-technics/companies/ и accounts/ideacom/companies/
- useCompanies.ts — порядок загрузки компаний
- App.tsx — selectedCompanyId логика
- localStorage currentAccountId — может быть перепутан после миграции
Исправить маппинг и убедиться что правильные инвойсы показываются для каждой компании.

### TASK-22 — КРИТИЧНО: жёсткое разделение баз данных по компаниям
Аудит и исправление всех слабых мест в изоляции данных между компаниями.
Три корневые проблемы:
1. Инвойсы читаются из одной плоской коллекции invoices/ с фильтром by companyId — не изолировано
2. useCompanies.ts имеет fallback на старую коллекцию companies/ — нестабильно
3. Нет жёсткой изоляции на уровне Firestore rules по companyId
Детали в SOLUTION.md.
