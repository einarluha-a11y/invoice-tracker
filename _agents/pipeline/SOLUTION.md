# SOLUTION

PHASE: DONE
ROUND: 1
TASK: TASK-08 — Dropbox прямая интеграция

## Выполнено

### dropbox_service.cjs — уже готов
Файл существовал и полностью реализован:
- OAuth2 refresh token flow (DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DROPBOX_REFRESH_TOKEN)
- Fallback на статический DROPBOX_ACCESS_TOKEN
- `uploadInvoiceToPDF()` — загрузка PDF-буфера в Dropbox
- `createCompanyFolder()` — создание папок (idempotent)
- `buildDropboxFolderPath()` — путь по структуре компании/год/месяц
- `listInvoicesInFolder()` — список файлов

Токены уже заданы в `.env.production` и Railway.

### invoice_processor.cjs — исправлено 2 проблемы

**1. Условие активации Dropbox:**
Было: `if (process.env.DROPBOX_ACCESS_TOKEN)` — не работало с OAuth2 токенами.
Стало: `const dropboxEnabled = process.env.DROPBOX_REFRESH_TOKEN || process.env.DROPBOX_ACCESS_TOKEN;`

**2. Сохранение dropboxPath в Firestore:**
После успешной загрузки добавлено:
`await db.collection('invoices').doc(payload.invoiceId).update({ dropboxPath });`

### Zapier webhook
Уже убран в предыдущих версиях.

## Верификация
- `node --check automation/invoice_processor.cjs` — OK
- `node --check automation/dropbox_service.cjs` — OK

DEPLOY_STATUS: OK
