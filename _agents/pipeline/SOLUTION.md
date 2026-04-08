# SOLUTION

PHASE: DONE
ROUND: 15
TASK: TASK-29 Round 2 — Merit Aktiva инструкция (уточнения по Perplexity review)

DEPLOY_STATUS: OK
node --check: ALL OK (automation/*.cjs)
build: OK — main chunk 293 kB, no warnings

## TASK-29 Round 2 — Изменения

По замечаниям Perplexity REVIEW round 14:

### 1. Точный путь получения API ключей (Merit портал)

**Войти на https://aktiva.merit.ee → Seaded → Välised ühendused → API**

Нажать "Loo uus API kasutaja". Заполнить:
- **Nimi (Name):** `Invoice-Tracker` (для идентификации)
- **Kirjeldus (Purpose/Description):** `Invoice sync automation`
- Скопировать `ApiId` и `ApiKey`

> ⚠️ Создание API пользователя требует прав администратора компании (omanik/owner).  
> Если раздела API нет — активировать в тарифном плане (Ettevõtete pakett или выше).

### 2. Health check endpoint — /gettaxes верифицирован

`merit_health_check.cjs` использует **GET /gettaxes** — это корректный выбор:
- Read-only операция (не создаёт данные)
- Официальный endpoint Merit API v1 (подтверждено в merit_sync.cjs line 120)
- `/sendinvoice` — отдельный endpoint для отправки инвойсов, не подходит для health check

### 3. Итоговая инструкция для Einar

```bash
# Шаг 1: получить ApiId + ApiKey на https://aktiva.merit.ee
# Seaded → Välised ühendused → API → Loo uus API kasutaja
# Name: Invoice-Tracker | Purpose: Invoice sync automation

# Шаг 2: установить в Railway
railway variables set MERIT_API_ID=<ApiId> MERIT_API_KEY=<ApiKey>

# Шаг 3: проверить подключение
node automation/merit_health_check.cjs
# → ✅ Подключение успешно. Налоговых ставок: N

# Шаг 4: тест одного инвойса
node automation/merit_sync.cjs --test --id <invoiceDocId>
```

> Требует: права owner/admin компании в Merit Aktiva.
