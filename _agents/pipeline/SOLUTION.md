# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-05 — Merit Aktiva интеграция (тестирование с реальными credentials)

## ЗАДАНИЕ

1. **Подготовка credentials**:
   - Создать `.env.merit` с реальными `MERIT_AKTIVA_CLIENT_ID`, `MERIT_AKTIVA_CLIENT_SECRET`, `MERIT_AKTIVA_COMPANY_ID` (получить у Einara)
   - Добавить в Railway: `railway variables set MERIT_AKTIVA_*` (все 3 vars)

2. **Тестовый скрипт** `automation/test_merit_aktiva.cjs`:
