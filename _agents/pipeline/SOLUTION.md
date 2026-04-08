# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-19 — Исправить все проблемы найденные при ревизии кода

## ВЫПОЛНЕНО

### ✅ 1. merit_aktiva_agent.cjs — cleanNum (предыдущий коммит)
Локальный parseFloat удалён, используется `cleanNum` из `core/utils.cjs`.

### ✅ 2. invoice_processor.cjs — IDEACOM_ID (предыдущий коммит)
Специальная логика для Ideacom удалена.

### ✅ 3. reconcile_bank_statement.cjs — захардкоженные companyId
Удалены fallback-значения `'vlhvA6i8d3Hry8rtrA3Z'` и `'bP6dc0PMdFtnmS5QTX4N'`.
Теперь только `process.env.COMPANY_ID_1` и `process.env.COMPANY_ID_2` (без дефолта).

### ✅ 4. ecosystem.config.cjs — защита от crash loop (предыдущий коммит)
`max_restarts: 10`, `restart_delay: 5000`, `exp_backoff_restart_delay: 100` для invoice-api и invoice-imap.

### ✅ 5. console.log — обёрнуты в DEBUG
- `invoice_processor.cjs`: `const debug = (...a) => process.env.DEBUG && console.log(...a)`, все 13 логов → `debug`
- `accountant_agent.cjs`: аналогично, 33 лога → `debug`
- `teacher_agent.cjs`: pipeline-логи (строки 114–889) → `debug`, интерактивные CLI (1053+) оставлены
- `imap_listener.cjs`: уже имел `const DEBUG`, 27 голых логов → `if (DEBUG)`, стартовое → `console.error`

### ✅ 6. ecosystem.config — entry point
`imap_daemon.cjs` существует.

## Верификация
- `node --check` всех изменённых файлов: OK

DEPLOY_STATUS: OK
