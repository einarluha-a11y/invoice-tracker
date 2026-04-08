# SOLUTION

PHASE: IMPLEMENTATION
ROUND: 1
TASK: TASK-19 — Полная ревизия кода, исправить все найденные проблемы

## ВЫПОЛНЕНО

### 🔴 КРИТИЧНО — исправлено

**1. merit_aktiva_agent.cjs — parseFloat → cleanNum**
- Удалена локальная функция `parseEuropeanNumber` (17 строк)
- Добавлен импорт `cleanNum` из `./core/utils.cjs`
- Заменены все 2 использования (строки 205, 317), убрана из exports

**2. invoice_processor.cjs — убран хардкод IDEACOM_ID**
- Удалён блок строк 75-101 (IDEACOM vendor-specific due date rule)
- Логика должна приходить через `customAiRules` компании, как и указано в самом комментарии

**3. reconcile_bank_statement.cjs — companyId через env vars**
- `companyId: process.env.COMPANY_ID_1 || 'bP6dc0PMdFtnmS5QTX4N'`
- `companyId: process.env.COMPANY_ID_2 || 'vlhvA6i8d3Hry8rtrA3Z'`

### 🟡 СРЕДНЕ — исправлено

**4. ecosystem.config.cjs — PM2 crash loop protection**
- Добавлено для `invoice-api` и `invoice-imap`:
  - `max_restarts: 10`
  - `restart_delay: 5000`
  - `exp_backoff_restart_delay: 100`

**5. console.log cleanup**
- `imap_listener.cjs`: добавлен `const DEBUG = process.env.DEBUG === '1'`, verbose attachment/storage logs обёрнуты в DEBUG-гарды
- `teacher_agent.cjs`: 4 error-related console.log заменены на console.error

**6. imap_daemon.cjs** — файл существует, entry point валиден

### Верификация
`node --check` — всё OK: merit_aktiva_agent, invoice_processor, reconcile_bank_statement, ecosystem.config, imap_listener, teacher_agent

## DEPLOY_STATUS: OK
