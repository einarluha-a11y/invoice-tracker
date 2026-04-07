# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-10 — Dropbox прямая интеграция (ждём credentials)

## ЗАДАНИЕ

Заменить Zapier на прямой Dropbox API для автоматической загрузки счетов.

**Что нужно сделать:**

1. Создать файл `automation/dropbox_service.cjs` с функциями:
   - `uploadInvoiceToPDF(invoiceId, pdfBuffer)` — загрузить PDF в папку `/Invoice-Tracker/{company}/{year}/{month}/`
   - `createCompanyFolder(companyName)` — автоматически создать структуру папок
   - `listInvoicesInFolder(companyName, year, month)` — список загруженных счетов

2. Интегрировать в `imap_daemon.cjs`:
   - После успешного парсинга счета вызвать `uploadInvoiceToPDF()` вместо отправки в Zapier
   - Убрать все ссылки на Zapier webhook

3. Добавить в `.env.pipeline`:
   ```
   DROPBOX_ACCESS_TOKEN=xxx
   DROPBOX_APP_KEY=xxx
   DROPBOX_APP_SECRET=xxx
   ```

4. Добавить в Railway variables через `railway variables set`

**Зависимость:** Нужны реальные Dropbox credentials от Einar (Access Token или App Key/Secret для OAuth2)

## Верификация

- `node automation/dropbox_service.cjs --test` успешно подключается к Dropbox
- В `imap_daemon.cjs` нет упоминаний Zapier
- Новый счет загружается в Dropbox в правильную папку
- Папки создаются автоматически если их нет

---

**Статус:** ⏳ BLOCKED — ждём Dropbox credentials от Einar
