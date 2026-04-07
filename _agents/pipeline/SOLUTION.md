# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Merit Aktiva интеграция — тестирование с реальными credentials

## ЗАДАНИЕ

Настроить и протестировать интеграцию с Merit Aktiva API:

1. **Добавить credentials в Railway** (`RAILWAY_MERIT_AKTIVA_*` env vars)
2. **automation/test_merit_aktiva.cjs** — LIVE тест с реальными данными:
   - Запросить последние 10 транзакций
   - Сохранить в `bank_transactions` (с тегом `merit_aktiva`)
   - Проверить reconciliation с существующими invoices
3. **automation/merit_aktiva_agent.cjs** — запустить 1 раз в день (cron):
   - Импорт новых транзакций (с `since` = last_import_time)
   - Авто-матчинг с invoices по amount+vendor
   - Лог в `memory/merit_aktiva.log`
4. **PM2 config** — добавить `merit_aktiva_agent` в cron (0 9 * * *)
5. **useBankTransactions.ts** — фильтр по source='merit_aktiva'
6. **InvoiceTable.tsx** — колонка "Merit Aktiva" (match status)

Создать тестовый аккаунт Merit Aktiva, получить API ключи.

## Верификация
- `railway variables list | grep MERIT` — credentials установлены
- `railway run node automation/test_merit_aktiva.cjs` — 10+ транзакций в Firestore
- `railway run node automation/merit_aktiva_agent.cjs` — лог без ошибок
- UI: таблица показывает Merit Aktiva транзакции + матчи
- `npm run build` — без ошибок
