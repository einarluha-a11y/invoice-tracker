# SOLUTION

PHASE: BLOCKED
ROUND: 2
TASK: TASK-08 — Dropbox интеграция (ждём credentials от Einar)

## Результат аудита TASK-08

Все требования TASK-08 **уже реализованы в коде**. Ждём только Dropbox credentials.

### Что готово

**1. `automation/dropbox_service.cjs`** ✅
- OAuth2 refresh token flow (DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DROPBOX_REFRESH_TOKEN)
- Fallback на статический DROPBOX_ACCESS_TOKEN
- uploadInvoiceToPDF(), createCompanyFolder(), buildDropboxFolderPath()

**2. Автоматические папки** ✅
/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3
/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/...

**3. Логирование dropboxPath в Firestore** ✅
invoice_processor.cjs:353 — db.collection('invoices').doc(id).update({ dropboxPath })

**4. Zapier outbound webhook** — убирается автоматически при добавлении Dropbox credentials (нет нужды вручную)

### Что нужно от Einar: создать Dropbox токен

1. Зайди на https://www.dropbox.com/developers/apps
2. Нажми **Create app**
3. Выбери **Scoped access** → **Full Dropbox**
4. Назови приложение (например: `invoice-tracker`)
5. В разделе **Permissions** включи:
   - `files.content.read`
   - `files.content.write`
   - `files.metadata.read`
   - `files.metadata.write`
6. В разделе **Settings** → **OAuth 2** → **Access token expiration** выбери **No expiration**
7. Нажми **Generate** под "Generated access token" — скопируй токен
8. В Railway добавь переменную: `DROPBOX_ACCESS_TOKEN = <скопированный токен>`

После добавления токена — запустить проверку: `node automation/dropbox_service.cjs --test`

### После успешной проверки
- Удалить любые оставшиеся Zapier webhook references из кода (если есть)
- Задеплоить Railway

## Верификация

- node --check automation/dropbox_service.cjs — ✅
- node --check automation/invoice_processor.cjs — ✅
- node --check automation/imap_listener.cjs — ✅
- npm run build — ✅ без ошибок TypeScript (2.58s)

DEPLOY_STATUS: OK
