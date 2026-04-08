# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-03 — ### TASK-03
**Фаза 3 — Backend auth middleware**

1. `api_server.cjs` — добавить verifyToken middleware на все /api/* роуты
2. `webhook_server.cjs` — аналогично
3. Frontend `api.ts` — добавить Authorization: Bearer {token} header ко всем fetch запросам
4. Делать одновременно frontend + backend (иначе сломается)

---

## ЗАДАНИЕ

**Цель:** Внедрить JWT авторизацию на все API эндпоинты. Токен из AuthContext.tsx должен передаваться в заголовке `Authorization: Bearer {token}` и проверяться на бэкенде.

### Backend (одновременно оба сервера):

**1. `api_server.cjs`**
