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

**Несмотря на аудит показывающий TASK-03 как DONE, задача требует перереализации с нуля для обеспечения стабильности auth flow.**

### Backend: api_server.cjs
1. Создать функцию `verifyToken(req, res, next)`:
