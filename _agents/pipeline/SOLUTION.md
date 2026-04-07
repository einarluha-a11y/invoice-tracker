# SOLUTION

TASK-08 — Мультипользовательский режим выполнен. Добавлен недостающий `GET /api/users/list` endpoint (master only) в `api_server.cjs`. Все остальные части были уже реализованы: Firestore схема (master_users, accounts, roles), Firestore rules, Login.tsx с выбором аккаунта, AuthContext.tsx (три роли), useCompanies.ts (accounts path + fallback), verifyToken/requireRole middleware на всех /api/* роутах, frontend authHeaders.

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-08 — Мультипользовательский режим (Master / Admin / User)

## Что сделано

### Новое: `GET /api/users/list` (api_server.cjs)
- Возвращает `[{ uid, email, role }]` для всех Firebase Auth пользователей
- Защищён `requireRole(['master'])` — только мастер видит список
- Использует `adminFb.auth().listUsers(1000)`
- Нужен для Settings.tsx → Управление ролями

### Уже было реализовано (TASK-01 → TASK-03)
- `firestore.rules` — master_users, accounts/{id}/users/{id}, isMaster(), isAccountMember(), isAccountAdmin()
- `AuthContext.tsx` — три роли (master/admin/user), currentAccountId, availableAccounts, selectAccount
- `Login.tsx` — datalist autocomplete аккаунтов + кнопка "Войти как мастер"
- `useCompanies.ts` — `accounts/{currentAccountId}/companies/` с fallback на `companies/`
- `webhook_server.cjs` — verifyToken + requireRole middleware
- `api_server.cjs` — requireRole на /api/chat, /api/invalidate-cache, /api/users/roles
- `src/data/api.ts` — authHeaders() добавляет Bearer token ко всем fetch
- `automation/migrate_to_accounts.cjs` — миграция companyId → accountId в invoices/bank_transactions
- `App.tsx` — AccountSelector для мастера

## Верификация
- `node --check` automation/api_server.cjs ✅
- `npm run build` ✅ (без TypeScript ошибок)

DEPLOY_STATUS: OK
