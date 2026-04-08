# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-19 — Исправить все проблемы найденные при ревизии кода

## ПРОБЛЕМЫ ДЛЯ ИСПРАВЛЕНИЯ

### 🔴 КРИТИЧНО

**1. merit_aktiva_agent.cjs — собственный parseFloat (строки 235,237,241,243,336)**
Удалить локальную функцию парсинга, импортировать cleanNum из core/utils.cjs и использовать везде.

**2. invoice_processor.cjs:80 — захардкоженный IDEACOM_ID**
`const IDEACOM_ID = "vlhvA6i8d3Hry8rtrA3Z"` — нарушает multitenancy.
Убрать специальную логику для Ideacom или сделать её конфигурируемой через Firestore.

**3. reconcile_bank_statement.cjs:32 — захардкоженный companyId**
`companyId: "vlhvA6i8d3Hry8rtrA3Z"` — передавать как параметр.

### 🟡 СРЕДНЕ

**4. ecosystem.config.cjs — добавить защиту от crash loop**
```js
max_restarts: 10,
restart_delay: 5000,
exp_backoff_restart_delay: 100
```
Для invoice-api и invoice-imap.

**5. 127 console.log в продакшн коде**
В teacher_agent.cjs, accountant_agent.cjs, imap_listener.cjs, invoice_processor.cjs.
Обернуть в `if (process.env.DEBUG)` или заменить на console.error где уместно.

**6. ecosystem.config — проверить entry point**
Запускает `imap_daemon.cjs` — убедиться что файл существует после разбивки на модули.

## Верификация
- node --check всех изменённых файлов
- pm2 restart all
- pm2 status — все процессы online

