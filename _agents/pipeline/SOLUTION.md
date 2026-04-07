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
