# SOLUTION

PHASE: REVIEW
ROUND: 1
TASK: TASK-03 — Фаза 3 — Backend auth middleware

## Статус

DEPLOY_STATUS: OK

## Верификация TASK-03

TASK-03 **уже реализован** в кодовой базе — проверка фактами:

### Backend: `webhook_server.cjs`

**Строки 20-66** — `verifyToken` middleware:
- Извлекает Firebase ID token из `Authorization: Bearer {token}`
- Проверяет через `admin.auth().verifyIdToken(token)`
- Резолвит роль из Firestore: `master_users/{uid}` → master, `accounts/{id}/users/{uid}` → role из документа
- Fallback на custom claims для legacy

**Строки 75-82** — защита всех `/api/*` маршрутов:
```js
app.use('/api', (req, res, next) => {
    if (req.path === '/intake') return next(); // Zapier — без токена
    return verifyToken(req, res, next);
});
```

Исключение только `/api/intake` (Zapier webhook — нет пользовательского токена).

### Frontend: все компоненты используют `authHeaders()`

- `src/data/api.ts:5-8` — `authHeaders()` экспортирует `Authorization: Bearer {token}`
- `AiChat.tsx` — `/api/chat` ✅
- `InvoiceTable.tsx` — `/api/reprocess-invoice` ✅
- `Settings.tsx` — `/api/users/list`, `/api/users/roles`, `/api/invalidate-cache` ✅
- `InvoicePdfViewer.tsx` — `/api/pdf-proxy` ✅

### Верификация

- `npm run build` — без ошибок TypeScript ✅
- `node --check` на `webhook_server.cjs` и `api_server.cjs` ✅

## Вывод

TASK-03 **полностью завершён** — backend и frontend синхронизированы. Auth middleware активен на всех защищённых маршрутах.

**Backlog (топ-5):**
1. TASK-04 — Cleanup (удалить VITE_ALLOWED_EMAILS, хардкод emails, старые bootstrap правила)
2. TASK-05 — Кэш правил + хардкод storage bucket
3. TASK-06 — Рефакторинг updateInvoice() — разбить 359 строк
4. TASK-07 — Разбивка imap_daemon.cjs на модули
5. TASK-08 — Dropbox интеграция (ждёт токены)

Что дальше — TASK-04?
