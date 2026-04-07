# SOLUTION

PHASE: INTEGRATION
ROUND: 1
TASK: Merit Aktiva интеграция — тестирование с реальными credentials

## Статус

**БЛОКЕР: Нужны credentials от Einar.**

Код написан и работает (`node --check` ✅), но без реальных API ключей тестирование невозможно.

## Что готово

### `automation/merit_aktiva_agent.cjs` (435 строк)
- HMAC-SHA256 аутентификация (Merit Aktiva v2 API)
- `fetchBankStatements(since, until)` — получение выписок
- Retry с exponential backoff (макс 3 попытки)
- Timeout 30s + fallback на кэш
- Логирование ошибок → `_agents/merit_aktiva_errors.log`
- Невалидный JSON → сохраняет в `_agents/raw_responses/`
- Запись в Firestore `config/integration_logs`

### `automation/test_merit_aktiva.cjs` (120 строк)
- Dry-run тест: принимает credentials из `.env.pipeline`
- Вызывает `fetchBankStatements()` за последние 7 дней
- Выводит raw JSON + распарсенные транзакции
- Проверяет: количество записей, формат сумм (European → float), даты (ISO)

## Нужно от Einar

Добавить в `.env.pipeline`:
```
MERIT_AKTIVA_USERNAME=<ApiId из Merit Aktiva настроек>
MERIT_AKTIVA_PASSWORD=<ApiKey из Merit Aktiva настроек>
# MERIT_AKTIVA_BASE_URL=https://aktiva.merit.ee/api/v2  (по умолчанию, менять не нужно)
```

После этого:
1. `node automation/test_merit_aktiva.cjs` — проверить парсинг
2. `railway variables set MERIT_AKTIVA_USERNAME=... MERIT_AKTIVA_PASSWORD=...`
3. Задеплоить

## Верификация синтаксиса

- `node --check automation/merit_aktiva_agent.cjs` ✅
- `node --check automation/test_merit_aktiva.cjs` ✅

DEPLOY_STATUS: WAITING_CREDENTIALS
