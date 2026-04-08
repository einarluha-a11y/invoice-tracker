# SOLUTION

PHASE: DONE
ROUND: 14
TASK: TASK-29 — Merit Aktiva активация (инструкция + health check скрипт)

DEPLOY_STATUS: OK
node --check: ALL OK (automation/*.cjs + merit_health_check.cjs)
build: OK — main chunk 293 kB, no warnings

## TASK-29 — Результат

### Что сделано

**`automation/merit_health_check.cjs`** — новый скрипт проверки подключения:
```
node automation/merit_health_check.cjs
# Проверяет MERIT_API_ID + MERIT_API_KEY
# Вызывает Merit API endpoint /gettaxes
# Выводит: ✅ Подключение успешно. Налоговых ставок: N
#     или: ❌ Ошибка подключения (с причиной)
```

### Инструкция для Einar

**Шаг 1 — Получить API ключи в Merit Aktiva:**
1. Войти на **https://aktiva.merit.ee**
2. Seaded → Välised ühendused → API
3. "Loo uus API kasutaja" → скопировать **API ID** и **API võti**

**Шаг 2 — Установить в Railway:**
```bash
railway variables set MERIT_API_ID=<твой_api_id> MERIT_API_KEY=<твой_api_key>
```

**Шаг 3 — Проверить:**
```bash
node automation/merit_health_check.cjs
```

**Шаг 4 — Тест с реальным инвойсом:**
```bash
node automation/merit_sync.cjs --test --id <invoiceDocId>
```

### Статус

Код полностью готов. Ожидает credentials от Einar (не код — ручное действие).
