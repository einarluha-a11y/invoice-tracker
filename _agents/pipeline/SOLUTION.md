# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим (Master / Admin / User)

## ЗАДАНИЕ

Реализовать систему ролей для инвойс-трекера:

1. **Firestore Security Rules** (`firestore.rules`)
2. **AuthContext.tsx** — три роли: master / admin / user
3. **Login.tsx** — выбор аккаунта перед входом
4. **useCompanies.ts** — фильтрация по аккаунту
5. **App.tsx** — AccountSelector для мастера

## ВЫПОЛНЕНО

### 1. `firestore.rules` — Security Rules для мультипользовательского режима
- `isMaster()` — проверка `master_users/{uid}`
- `isAccountMember(accountId)` — проверка `accounts/{accountId}/users/{uid}`
- `isAccountAdmin(accountId)` — проверка role == 'admin'
- Коллекции `accounts/{id}`, `accounts/{id}/users/{id}`, `accounts/{id}/companies/{id}` защищены по ролям
- Мастер имеет доступ ко всему; admin — к своему аккаунту; user — только чтение

### 2. `src/context/AuthContext.tsx` — логика трёх ролей
- После signInWithGoogle: проверка `master_users/{uid}` → role='master'
- Иначе: `accounts/{accountId}/users/{uid}` → role из документа ('admin'|'user')
- Нет доступа → signOut + сообщение "Нет доступа к аккаунту"
- Контекст: `currentAccountId`, `userRole`, `isMaster`, `availableAccounts`, `selectAccount()`
- Мастер после входа видит AccountSelector (список всех accounts/)

### 3. `src/components/Login.tsx` — выбор аккаунта перед входом
- Input с datalist autocomplete по `accounts/` коллекции (только поле `name`)
- Кнопка "Sign in with Google" — только если аккаунт выбран
- Кнопка "Войти как мастер" — без выбора аккаунта
- Выбранный accountId сохраняется в pendingAccountIdRef

### 4. `src/hooks/useCompanies.ts` — фильтрация по аккаунту
- Путь: `accounts/{currentAccountId}/companies/`
- Fallback на старый путь `companies/` если account-коллекция пуста
- CRUD: только master и admin (canWrite = isMaster || userRole === 'admin')

### 5. `src/App.tsx` — AccountSelector для мастера
- Мастер без выбранного аккаунта видит экран AccountSelector
- В header: dropdown для переключения аккаунта мастером

### Верификация
- `npm run build` — ✅ (379 modules, без TypeScript ошибок)
- `node --check automation/merit_aktiva_agent.cjs` — ✅
- `node --check automation/test_merit_aktiva.cjs` — ✅

DEPLOY_STATUS: OK
