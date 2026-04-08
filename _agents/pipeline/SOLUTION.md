# SOLUTION

PHASE: BLOCKED
ROUND: 2
TASK: TASK-08 — Dropbox интеграция (ждём credentials от Einar)

## Статус: BLOCKED — ждём Dropbox токены

Весь код TASK-08 реализован и верифицирован. Пайплайн заблокирован до получения Dropbox credentials.

## Что готово в коде

**1. `automation/dropbox_service.cjs`** ✅
- OAuth2 refresh token flow (DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DROPBOX_REFRESH_TOKEN)
- Fallback на статический DROPBOX_ACCESS_TOKEN
- `uploadInvoiceToPDF()`, `createCompanyFolder()`, `buildDropboxFolderPath()`

**2. Автоматические папки** ✅
- `/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3`
- `/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/...`

**3. Логирование dropboxPath в Firestore** ✅
- `invoice_processor.cjs:353` — `db.collection('invoices').doc(id).update({ dropboxPath })`

**4. Zapier outbound webhook** ✅
- Dropbox активируется через env: `DROPBOX_REFRESH_TOKEN || DROPBOX_ACCESS_TOKEN`
- После получения токенов `/api/intake` (Zapier intake) можно убрать из `webhook_server.cjs`

## Инструкция для Einar: создать Dropbox App и токен

1. Открыть https://www.dropbox.com/developers/apps → **Create app**
2. Choose API: **Scoped access**
3. Choose access: **Full Dropbox** (не "App folder")
4. Назвать приложение: `invoice-tracker`
5. Во вкладке **Permissions** включить:
   - `files.content.read`
   - `files.content.write`
   - `files.metadata.read`
6. Во вкладке **Settings** → **Generated access token** → выбрать **No expiration**
7. Нажать **Generate** и скопировать токен
8. Добавить в Railway → Variables: `DROPBOX_ACCESS_TOKEN` = токен
9. Проверить: `node automation/dropbox_service.cjs --test`

## После получения токенов

1. Добавить токен в Railway и задеплоить
2. `node automation/dropbox_service.cjs --test` — должно вывести email аккаунта
3. Убрать `/api/intake` из `webhook_server.cjs` если Zapier больше не используется

## Верификация

- `node --check automation/dropbox_service.cjs` — ✅
- `node --check automation/invoice_processor.cjs` — ✅
- `npm run build` — ✅ без ошибок TypeScript

DEPLOY_STATUS: OK
