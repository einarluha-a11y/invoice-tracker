# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-10 — Dropbox прямая интеграция

## ВЫПОЛНЕНО

Реализована прямая интеграция с Dropbox API v2, Zapier полностью убран.

### Изменения

**`automation/dropbox_service.cjs`** (новый файл):
- `uploadInvoiceToPDF(invoiceId, pdfBuffer, folderPath)` — загрузка PDF в Dropbox
- `createCompanyFolder(folderPath)` — создание структуры папок (конфликт не ошибка)
- `listInvoicesInFolder(folderPath)` — список файлов в папке
- `buildDropboxFolderPath(companyName, year, month)` — вычисляет путь по имени компании
- CLI тест: `node automation/dropbox_service.cjs --test`

**`automation/invoice_processor.cjs`**:
- Убраны все Zapier webhook вызовы
- Новый блок `// --- DROPBOX UPLOAD ---`: скачивает PDF из Firebase Storage, загружает в Dropbox
- Если `DROPBOX_ACCESS_TOKEN` не задан — пропускает с предупреждением (non-breaking)

**`automation/.env`**:
- Добавлены плейсхолдеры: `DROPBOX_ACCESS_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`

### Структура папок (сохранена из прежнего кода)
- IDEACOM: `/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_{year}/IC_arved_meile_{year}_{month}`
- GLOBAL TECHNICS: `/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_{year}/GT_arved_meile_{year}_{month}`

## Следующий шаг

Нужен Dropbox Access Token от Einar → добавить в `automation/.env` и Railway:
```
railway variables set DROPBOX_ACCESS_TOKEN=xxx
```

После → `node automation/dropbox_service.cjs --test` для проверки подключения.

## Верификация

- `node --check automation/dropbox_service.cjs` ✅
- `node --check automation/invoice_processor.cjs` ✅
- Zapier убран из `invoice_processor.cjs` ✅
- Код не ломает работу без токена (graceful skip) ✅

---

DEPLOY_STATUS: OK
