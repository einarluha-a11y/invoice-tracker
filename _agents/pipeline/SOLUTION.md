# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-03 — Backend auth middleware

## Выполнено

### 1. automation/webhook_server.cjs — verifyToken middleware
- Добавлена функция `verifyToken` (Firebase Admin auth)
- `app.use('/api', ...)` защищает все `/api/*` роуты
- Исключение: `/api/intake` — Zapier webhook без пользовательского токена

### 2. src/data/api.ts — authHeaders helper
- Добавлен импорт `getAuth` из firebase/auth
- Экспортирована функция `authHeaders()` — возвращает `{ Authorization: Bearer <token> }` если пользователь залогинен

### 3. Компоненты — Bearer token в fetch
- **AiChat.tsx** → `/api/chat`
- **Settings.tsx** → `/api/invalidate-cache`
- **InvoiceTable.tsx** → `/api/reprocess-invoice`

## Верификация
- `node --check automation/webhook_server.cjs` ✓
- `node --check automation/api_server.cjs` ✓
- `npm run build` ✓ (без TypeScript ошибок)

DEPLOY_STATUS: OK
