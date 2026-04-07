# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-02 — Фаза 2 Frontend мультипользовательский режим

## ВЫПОЛНЕНО

### 1. Login.tsx
- Добавлен input "Название аккаунта" с HTML5 datalist autocomplete (данные из `accounts/`)
- Кнопка "Sign in with Google" активна только при выбранном аккаунте
- Кнопка "Войти как мастер" — вход без выбора аккаунта, AuthContext сам определяет master role
- Выбранный accountId передаётся в `signInWithGoogle(accountId)`

### 2. AuthContext.tsx
- `signInWithGoogle(accountId?)` принимает опциональный accountId (через ref, не state)
- `onAuthStateChanged`: сначала проверяет `master_users/{uid}` → если есть, грузит все `accounts/`
- Обычный пользователь: проверяет `accounts/{accountId}/users/{uid}` → role из документа
- Нет доступа → signOut + authError
- Persistence: accountId в localStorage (currentAccountId / masterSelectedAccount)
- Новые поля контекста: currentAccountId, userRole, isMaster, availableAccounts, selectAccount

### 3. useCompanies.ts
- Зависит от `currentAccountId` и `isMaster` из AuthContext
- `getDocs(accounts/{accountId}/companies)` → если пусто, fallback на `companies/`
- onSnapshot на выбранный путь, activePathRef для CRUD операций
- addCompany/deleteCompany: бросают ошибку если `!canWrite` (canWrite = isMaster || role=admin)

### 4. App.tsx
- Добавлен компонент `AccountSelector` — список кнопок из `availableAccounts`
- Если `isMaster && !currentAccountId` → рендерит AccountSelector вместо дашборда
- В хедере для мастера добавлен select для переключения аккаунтов
- `selectAccount(id)` → сбрасывает selectedCompanyId, меняет currentAccountId

### Верификация
- `npm run build` — ✅ без ошибок TypeScript

DEPLOY_STATUS: OK
