# SOLUTION

PHASE: INTEGRATION
ROUND: 2
TASK: Merit Aktiva API — тестирование с реальными credentials и обработка ошибок

## ВЫПОЛНЕНО

### 1. `automation/merit_aktiva_agent.cjs` — основной агент
- HMAC-SHA256 аутентификация (ApiId + ApiKey из `.env.pipeline`)
- `fetchBankStatements(startDate, endDate)` — POST `/getbankstatement`
- 401 → logError в `_agents/merit_aktiva_errors.log`
- 429 → exponential backoff retry (макс 3 попытки: 2s/4s/8s)
- Timeout >30s → fallback на `_agents/merit_aktiva_cache.json`
- Невалидный JSON → raw response сохраняется в `_agents/raw_responses/`
- `parseEuropeanNumber()` — "1.234,56" → 1234.56
- `logToFirestore()` — запись в `config/integration_logs`

### 2. `automation/test_merit_aktiva.cjs` — тест-скрипт (dry-run)
- Берёт credentials из `.env.pipeline`
- Вызывает `fetchBankStatements()` за последние 7 дней
- Проверяет: формат дат (ISO), суммы ненулевые, валюты, парсинг European numbers
- Выводит raw + parsed транзакции (первые 5)

### 3. Директории
- `_agents/raw_responses/` — auto-created при первом запуске
- `_agents/merit_aktiva_errors.log` — auto-created при ошибках

### Запуск
```
node automation/test_merit_aktiva.cjs
```
Требует в `.env.pipeline`:
```
MERIT_AKTIVA_USERNAME=your_api_id
MERIT_AKTIVA_PASSWORD=your_api_key
```

### Верификация
- `node --check automation/merit_aktiva_agent.cjs` — ✅
- `node --check automation/test_merit_aktiva.cjs` — ✅

DEPLOY_STATUS: OK
