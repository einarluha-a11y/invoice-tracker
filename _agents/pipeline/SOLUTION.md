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

## ВЫПОЛНЕНО

- `verifyToken` → `req.role = decoded.role || 'user'`
- `requireRole(roles)` middleware добавлен и экспортирован из webhook_server.cjs
- `/api/reprocess-invoice` → requireRole(['admin', 'master'])
- `/api/chat` → requireRole(['user', 'admin', 'master'])
- `/api/invalidate-cache` → requireRole(['admin', 'master'])
- `/api/users/roles` POST → requireRole(['master']), устанавливает custom claims
- Settings.tsx: показывает currentRole; master видит таблицу пользователей с dropdown + кнопка Set role
- `automation/seed_roles.cjs` создан; запуск: `MASTER_EMAIL=<email> node automation/seed_roles.cjs`
- `node --check` ✓ все файлы, `npm run build` ✓
- Коммит e6075c1 запушен в main

## Инструкция для Einar (Firebase Console)
Чтобы назначить роль 'master' владельцу:
1. Добавить `MASTER_EMAIL=einar@example.com` в `.env`
2. `node automation/seed_roles.cjs`

Для тестового admin аккаунта — в Firebase Console → Authentication → Users → выбрать пользователя → Edit → Custom claims: `{"role":"admin"}`

DEPLOY_STATUS: OK
