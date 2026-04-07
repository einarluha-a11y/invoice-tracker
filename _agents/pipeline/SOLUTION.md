# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-07 — Разбивка imap_daemon.cjs на модули

## ВЫПОЛНЕНО

Разбил монолитный `imap_daemon.cjs` (1545 строк) на 5 специализированных модулей:

### Новые модули

**`imap_listener.cjs`** — IMAP подключение, poll loop, обработка вложений
- `checkEmailForInvoices()` — подключение к IMAP, парсинг писем, роутинг PDF/CSV/image
- `pollAllCompanyInboxes()` — обход всех компаний из Firestore
- `checkAndRunFlagTasks()` — запуск .flag задач через child_process
- `pollLoop()` — бесконечный цикл опроса (каждые 2 мин)

**`invoice_processor.cjs`** — Scout→Teacher pipeline + writeToFirestore
- `scoutTeacherPipeline()`, `writeToFirestore()`, `uploadToStorage()`, `parseInvoiceDataWithAI()`

**`bank_statement_processor.cjs`** — CSV парсинг + reconcilePayment
- `reconcilePayment()`, `processBankStatement()`, `parseBankStatementWithAI()`

**`status_sweeper.cjs`** — sweepStatuses + auditLoop
- `sweepStatuses()`, `auditLoop()`

**`imap_daemon.cjs`** — точка входа (17 строк вместо 1545)
- Импортирует из всех 4 модулей
- Запускает `pollLoop()` + `auditLoop()` при прямом запуске
- Сохраняет обратную совместимость через `module.exports`

### Верификация
- `node --check` пройден для всех 5 файлов

DEPLOY_STATUS: OK
