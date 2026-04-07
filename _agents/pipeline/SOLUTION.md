# SOLUTION

PHASE: INTEGRATION
ROUND: 2
TASK: Merit Aktiva API — тестирование с реальными credentials и обработка ошибок

## ЗАДАНИЕ

Claude должен:

1. **Подготовить тестовый скрипт** (`automation/test_merit_aktiva.cjs`):
   - Принимает credentials из `.env.pipeline` (MERIT_AKTIVA_USERNAME, MERIT_AKTIVA_PASSWORD)
   - Вызывает `fetchBankStatements()` с тестовым периодом (последние 7 дней)
   - Выводит raw JSON ответ + распарсенные транзакции
   - Проверяет: количество записей, формат сумм, даты, валюту

2. **Добавить обработку ошибок** в `automation/merit_aktiva_agent.cjs`:
   - 401 Unauthorized → логировать в `_agents/merit_aktiva_errors.log`
   - 429 Rate limit → retry с exponential backoff (макс 3 попытки)
   - Timeout (>30s) → fallback на кэш последней успешной выписки
   - Невалидный JSON → сохранить raw response в `_agents/raw_responses/`

3. **Запустить тестирование**:
   - `node automation/test_merit_aktiva.cjs` (dry-run, без сохранения)
   - Проверить логи: успешно ли парсятся суммы, даты, описания
   - Если ошибки — зафиксировать в `CLAUDE.md` (раздел "Merit Aktiva Issues")

4. **Обновить `automation/merit_aktiva_agent.cjs`**:
   - Добавить retry-логику
   - Добавить timeout обработку
   - Добавить логирование в Firestore (`config/integration_logs`)

## Верификация

- `node automation/test_merit_aktiva.cjs` выводит 5+ транзакций без ошибок
- Суммы распарсены корректно (European format: 1.234,56 → 1234.56)
- Даты в ISO формате (YYYY-MM-DD)
- Логи ошибок (если есть) записаны в `_agents/merit_aktiva_errors.log`
- `npm run build` — без ошибок TypeScript
