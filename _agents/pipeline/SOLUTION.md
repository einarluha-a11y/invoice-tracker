# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Фаза 2 — Frontend мультипользовательский режим (Login / AuthContext / useCompanies)

## ARCHITECTURE

### Анализ задачи
Реализовать три изменения во фронтенде:
1. **Login.tsx** — выбор аккаунта перед входом + кнопка "Войти как мастер"
2. **AuthContext.tsx** — логика трёх ролей (master/admin/user) через Firestore
3. **useCompanies.ts** — чтение из `accounts/{accountId}/companies/` вместо `companies/`

### Варианты решения

**Вариант A: Централизованный контекст (выбрано)**
- AuthContext хранит все auth-данные (uid, role, accountId)
- Login.tsx берёт список аккаунтов из Firestore и передаёт accountId при входе
- useCompanies.ts читает accountId из контекста
- **Плюсы:** единая точка правды, нет prop drilling
- **Минусы:** нет

**Вариант B: URL-based routing по аккаунту**
- Аккаунт как часть URL (`/accounts/:id/dashboard`)
- **Плюсы:** deep linking
- **Минусы:** избыточно, ломает текущую архитектуру

**Вариант C: Мультитенант через Firebase Custom Claims**
- role/accountId в JWT токене
- **Плюсы:** нет Firestore запросов при каждом auth check
- **Минусы:** требует Cloud Functions для выдачи claims, избыточно на данном этапе

### Выбранное решение
**Вариант A** — централизованный AuthContext.

Схема данных в Firestore:
- `master_users/{uid}` — пустой документ, само наличие = мастер
- `accounts/{accountId}` — `{ name: string }`
- `accounts/{accountId}/users/{uid}` — `{ role: 'admin' | 'user' }`
- `accounts/{accountId}/companies/{companyId}` — аналог старого `companies/`

Логика входа:
1. Login.tsx загружает `accounts/` (только name), отображает autocomplete
2. Пользователь выбирает аккаунт → нажимает "Sign in with Google"
3. Мастер нажимает "Войти как мастер" (без выбора аккаунта)
4. onAuthStateChanged:
   - Проверить `master_users/{uid}` → если есть: role='master', загрузить все accounts
   - Иначе: взять accountId из pendingRef/localStorage → проверить `accounts/{accountId}/users/{uid}` → role
   - Нет доступа → signOut + ошибка

useCompanies.ts:
- Если `accounts/{accountId}/companies/` не пустой — читать оттуда
- Иначе — fallback на `companies/` (backward compatibility)
- CRUD только для master/admin

App.tsx:
- Мастер после входа видит AccountSelector (если accountId не выбран)
- В header: master видит dropdown всех аккаунтов для быстрого переключения
- Settings скрыт для role='user'

### План реализации
- `src/context/AuthContext.tsx` — роли + pendingAccountIdRef + selectAccount
- `src/components/Login.tsx` — datalist autocomplete + "Войти как мастер"
- `src/hooks/useCompanies.ts` — accountPath + fallback + canWrite
- `src/App.tsx` — AccountSelector + account switcher в header

### Учтённые протоколы Charter
- §7 Workspace Compartmentalization — компании изолированы по accountId
- §3 File Preservation — не затрагивает pipeline, только UI-слой
- Backward compatibility — fallback на `companies/` если `accounts/.../companies/` пуст

### Риски
- `accounts/` могут быть недоступны для неаутентифицированного пользователя (firestore.rules). Решение: Login.tsx обрабатывает ошибку getDocs молча — пользователь вводит название вручную.
- Master без выбранного accountId видит пустой AccountSelector. Решение: App.tsx показывает AccountSelector если `isMaster && !currentAccountId`.

---

*Примечание: код уже реализован в коммите 584ea6c в рамках предыдущего шага. Этот ARCHITECTURE документ описывает принятые решения постфактум для ревью Perplexity перед официальной CODE фазой.*
