# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-04 — Мультипользовательский режим (Master / Admin / User)

## ЗАДАНИЕ

1. **Backend — роли в middleware** (automation/webhook_server.cjs):
   - В `verifyToken` после `decodedToken` проверять custom claims: `role: decodedToken.role || 'user'`
   - Добавить middleware `requireRole(roles)` — массив ['admin', 'master'], если req.user.role не в списке → 403
   - Защитить роуты:
     - `/api/invalidate-cache`, `/api/reprocess-invoice` → `requireRole(['admin', 'master'])`
     - `/api/chat` → только `requireRole(['user', 'admin', 'master'])`
   - Добавить роут `/api/users/roles` (POST) — только master: `admin.auth().setCustomUserClaims(uid, {role})`

2. **Frontend — UI ролей** (src/components/Settings.tsx или новый Users.tsx):
   - Показывать текущую роль пользователя (из auth.currentUser.getIdTokenResult())
   - Для master — таблица пользователей с dropdown ролью + кнопка "Set role"
   - Кнопки с проверкой роли: admin-only для cache/reprocess

3. **Seed данных**:
   - Создать скрипт `automation/seed_roles.cjs` — задать role: 'master' текущему пользователю (по email из .env)
   - Запустить один раз: `node automation/seed_roles.cjs`

4. **Firebase Console** (укажи инструкцию для Einara):
   - В Authentication → Users → добавить custom claim `{role: "admin"}` для тестового аккаунта

## Верификация
- `node --check automation/webhook_server.cjs` ✓
- `npm run build` ✓
- Тест ролей: curl с токеном user → 403 на /api/invalidate-cache; master → 200
- UI показывает роль, master видит "Set role" кнопки
- `node automation/seed_roles.cjs` выполняется без ошибок

DEPLOY_STATUS: ожидается OK после PR merge
