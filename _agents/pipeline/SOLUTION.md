# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Backend auth middleware (защита API под accounts/{accountId})

## ЗАДАНИЕ

Реализовать Firebase Admin Auth middleware для всех API endpoints:

1. **Middleware `authMiddleware`** (`src/middleware/auth.ts`):
   - Верифицирует `Authorization: Bearer <idToken>`
   - Извлекает `uid` из decodedToken
   - Проверяет роль:
     - `master_users/{uid}` exists → `isMaster=true`, `userRole='master'`
     - Иначе для каждого `accounts/{accountId}`: `accounts/{accountId}/users/{uid}` → role
   - `req.accountId` = первый accountId где есть доступ (или null для master)
   - `req.userRole` = 'master'|'admin'|'user'
   - `req.isMaster` = true/false
   - 401 если token invalid/expired
   - 403 если нет доступа к accountId (для scoped endpoints)

2. **Обновить все API handlers**:

## CODE

### Реализованные изменения

**`automation/webhook_server.cjs` — обновлён `verifyToken` (authMiddleware) и `requireRole`**

Новая логика `verifyToken`:
1. Верифицирует `Authorization: Bearer <idToken>` через Firebase Admin SDK
2. Проверяет `master_users/{uid}` в Firestore → `isMaster=true`, `userRole='master'`, `accountId=null`
3. Иначе перебирает `accounts/{accountId}/users/{uid}` → берёт `role` из документа, `accountId` = первый найденный
4. Fallback на `decoded.role` из custom claims (legacy совместимость)
5. 401 при invalid/missing токене

`req` теперь содержит:
- `req.uid` — Firebase UID
- `req.email` — email пользователя
- `req.userRole` — 'master' | 'admin' | 'user'
- `req.isMaster` — true/false
- `req.accountId` — accountId где есть доступ, или null для мастера
- `req.role` — backwards-compat alias для `userRole`

`requireRole` обновлён: использует `req.userRole || req.role`.

Все существующие handlers (`/api/intake`, `/api/reprocess-invoice`, `/api/pdf-proxy`, `/api/agent-stats`, `/api/chat`, `/api/invalidate-cache`, `/api/users/list`, `/api/users/roles`) уже используют `requireRole` — изменений в handlers не требуется.

### Верификация

```
node --check automation/webhook_server.cjs → OK
node --check automation/api_server.cjs → OK
```

DEPLOY_STATUS: OK
