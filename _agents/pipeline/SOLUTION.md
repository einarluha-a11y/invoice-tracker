# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-19 — Полная ревизия кода, исправить все найденные проблемы

## РЕЗУЛЬТАТЫ АУДИТА от Perplexity

### 🔴 КРИТИЧНО

**1. parseFloat в merit_aktiva_agent.cjs (5 мест)**
Файл имеет собственную локальную функцию парсинга вместо `cleanNum` из utils.cjs.
Строки 235, 237, 241, 243, 336.
Решение: удалить локальную функцию, импортировать и использовать `cleanNum`.

**2. Захардкоженный IDEACOM_ID в invoice_processor.cjs:80**
`const IDEACOM_ID = "vlhvA6i8d3Hry8rtrA3Z"` — прямое нарушение multitenancy архитектуры.
Решение: загружать companyId динамически из Firestore или убрать эту специальную логику полностью.

**3. Захардкоженный companyId в reconcile_bank_statement.cjs:32**
`companyId: "vlhvA6i8d3Hry8rtrA3Z"` — hardcoded Ideacom ID.
Решение: передавать companyId как параметр.

### 🟡 СРЕДНЕ

**4. ecosystem.config.cjs — нет max_restarts и restart_delay**
При краше PM2 перезапускает мгновенно → crash loop.
Добавить для invoice-api и invoice-imap:
```js
max_restarts: 10,
restart_delay: 5000,
exp_backoff_restart_delay: 100
```

**5. 127 console.log в продакшн коде**
В teacher_agent.cjs, accountant_agent.cjs, imap_listener.cjs, invoice_processor.cjs.
Заменить на `console.error` для ошибок, остальные убрать или обернуть в `if (process.env.DEBUG)`.

**6. imap_daemon.cjs ссылается в ecosystem.config но файл разбит на модули**
ecosystem.config.cjs запускает `imap_daemon.cjs` — проверить что entry point существует или обновить на правильный файл.

### 🟢 ХОРОШО
- Синтаксис всех .cjs файлов чистый
- getVendorAliases унифицирован через utils.cjs
- Разбивка imap_daemon на модули выполнена
- cleanNum используется в большинстве мест

## ИНСТРУКЦИЯ

1. Изучи каждую проблему
2. Предложи решение для каждой (можешь уточнить если что-то неясно)
3. После согласования — исправь всё в одном коммите
4. Верификация: node --check всех изменённых файлов, pm2 restart all

