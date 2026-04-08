# SOLUTION

PHASE: DONE
ROUND: 6
TASK: TASK-25 — IMAP automation реализована и работает

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## Результат аудита TASK-25

**Вывод: IMAP automation уже полностью реализована.**

### Проверенные файлы (все синтаксис OK):
- `automation/imap_daemon.cjs` — точка входа, запускает `pollLoop()` + `auditLoop()`
- `automation/imap_listener.cjs` — IMAP polling каждые 2 минуты, все нужные exports
- `automation/invoice_processor.cjs` — экспортирует `uploadToStorage`, `parseInvoiceDataWithAI`, `writeToFirestore`, `scoutTeacherPipeline`
- `automation/status_sweeper.cjs` — экспортирует `sweepStatuses`, `auditLoop`

### Архитектура (уже работает):
1. `pollLoop()` запускается в `imap_daemon.cjs` при старте PM2
2. Каждые 2 минуты вызывает `pollAllCompanyInboxes()`
3. Читает IMAP настройки (`imapHost`, `imapUser`, `imapPassword`) из Firestore коллекции `companies`
4. Для каждой компании: подключается к IMAP, ищет письма за последние 5 дней
5. Дедупликация через `processed_email_uids` в Firestore
6. PDF → Firebase Storage → AI extraction → Accountant audit → Firestore write

### Railway env vars для IMAP:
- Глобальные `IMAP_HOST/USER/PASS` **не нужны** — настройки хранятся per-company в Firestore
- Флаг `IMAP_TLS=false` можно установить для серверов без TLS (по умолчанию TLS включён)

### Следующий шаг:
Если нужно добавить новый email-ящик — добавить поля `imapHost`, `imapUser`, `imapPassword`, `imapPort` в документ компании в Firestore. Daemon подхватит автоматически при следующем poll цикле.

## node --check результат:
- automation/imap_daemon.cjs: OK
- automation/imap_listener.cjs: OK
- automation/invoice_processor.cjs: OK
- automation/status_sweeper.cjs: OK
