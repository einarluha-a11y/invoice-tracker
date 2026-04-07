# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-02 — Фаза 2 Frontend мультипользовательский режим

## ЗАДАНИЕ

Реализуй три изменения во фронтенде. Не трогай backend — только src/.

### 1. Login.tsx — поле выбора аккаунта

Перед кнопкой Google Sign In добавить:
- Input "Название аккаунта" с autocomplete по коллекции `accounts/` (только поле name)
- Для мастера uid=MI9J2VBriwQ45jEMJ5tmbagfHm93 — показывать кнопку "Войти как мастер" (пропускает выбор аккаунта)
- Сохранять выбранный accountId в локальный state до Google входа

### 2. AuthContext.tsx — три роли

После signInWithGoogle:
1. Проверить uid в `master_users/{uid}` → role='master', isMaster=true
2. Иначе: проверить `accounts/{selectedAccountId}/users/{uid}` → role из документа
3. Если нет → signOut + authError: "Нет доступа к аккаунту. Обратитесь к администратору."

Добавить в контекст:
- currentAccountId: string | null
- userRole: 'master' | 'admin' | 'user' | null
- isMaster: boolean
- availableAccounts: Account[] (только для мастера — список всех accounts/)
- selectAccount(accountId: string): void — для мастера чтобы переключаться

### 3. useCompanies.ts — фильтрация по аккаунту

- Новый путь: `accounts/{currentAccountId}/companies/`
- Для мастера: принимать accountId как параметр через selectAccount
- CRUD addCompany/deleteCompany — только если isMaster || role === 'admin'
- Backward compat: если accounts/{accountId}/companies/ пустой → fallback на `companies/`

### 4. App.tsx — AccountSelector для мастера

Если isMaster и не выбран accountId → показать AccountSelector компонент:
- Список всех аккаунтов из availableAccounts
- При выборе → selectAccount(id) → загрузить компании этого аккаунта

### Верификация
- `npm run build` без TypeScript ошибок
- `npm run dev` — войти как einar.luha@gmail.com
- Мастер видит AccountSelector → выбирает Global Technics → видит инвойсы
- Мастер переключается на Ideacom → видит инвойсы Ideacom

