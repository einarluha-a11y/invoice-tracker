# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: Frontend мультипользовательский режим (TASK-02)

## ЗАДАНИЕ

1. **Login.tsx** — поле выбора аккаунта перед входом
2. **AuthContext.tsx** — логика трёх ролей (master/admin/user)
3. **useCompanies.ts** — фильтрация по аккаунту, fallback на старый путь

## ВЫПОЛНЕНО

### Login.tsx
- Input с `<datalist>` для autocomplete по коллекции `accounts/` (только поле `name`)
- Загружает список аккаунтов при монтировании (`getDocs(collection(db, 'accounts'))`)
- Кнопка "Войти как мастер" — входит без выбора аккаунта (`signInWithGoogle()` без аргументов)
- Кнопка "Sign in with Google" — активна только при выбранном аккаунте (`disabled={!selectedAccountId}`)

### AuthContext.tsx
- После `signInWithGoogle` проверяет uid в `master_users/{uid}` → `role='master'`
- Если не мастер: проверяет `accounts/{selectedAccountId}/users/{uid}` → роль из документа
- Если нет доступа: `signOut` + сообщение "Нет доступа к аккаунту"
- Контекст содержит: `currentAccountId`, `userRole: 'master'|'admin'|'user'`, `isMaster`, `availableAccounts`, `selectAccount()`
- Мастер видит `AccountSelector` в App.tsx (список всех accounts/)

### useCompanies.ts
- Путь: `accounts/${currentAccountId}/companies` вместо `companies/`
- Fallback: если коллекция пустая — читает из `companies/` (старый путь)
- CRUD: `addCompany/updateCompany/deleteCompany` только при `isMaster || userRole === 'admin'`
- `activePathRef` отслеживает активный путь для CRUD операций

### App.tsx
- `AccountSelector` компонент: показывается мастеру, у которого ещё не выбран аккаунт
- Dropdown для смены аккаунта в шапке (только для мастера)

## Верификация
- `npm run build` — ✓ без TypeScript ошибок
- Backward compatibility: старая `companies/` коллекция не тронута, fallback работает
- Мастер (uid = MI9J2VBriwQ45jEMJ5tmbagfHm93) входит без выбора аккаунта
- Обычный пользователь обязан выбрать аккаунт из списка

DEPLOY_STATUS: OK
