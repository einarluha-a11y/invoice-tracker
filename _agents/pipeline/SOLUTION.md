# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Архитектурный анализ мультипользовательского режима

## РЕЗУЛЬТАТ АНАЛИЗА

### 1. AuthContext.tsx (`src/context/AuthContext.tsx`)

**Текущее состояние:**
- Аутентификация через Google OAuth (Firebase)
- Allowlist по email через `VITE_ALLOWED_EMAILS` + 3 захардкоженных адреса
- Роли нет вообще — все видят все компании
- Context возвращает: `user`, `loading`, `signInWithGoogle`, `logout`

**Что менять:**
```
Добавить в контекст:
  - currentAccountId: string | null
  - userRole: 'master' | 'admin' | 'user' | null
  - isMaster: boolean

Логика после signInWithGoogle:
  1. Проверить uid в system/master_users → если есть: role='master'
  2. Иначе: взять выбранный accountId из state (введён до входа)
  3. Проверить accounts/{accountId}/users/{uid} → role из документа
  4. Если нет → "Нет доступа"
```

**Риск:** Мастер-проверка через `system/master_users` — нужно правило Firestore, что этот путь читаем только аутентифицированным. Если uid не совпадает — silent fail, не должен выдавать ошибку.

---

### 2. useCompanies.ts (`src/hooks/useCompanies.ts`)

**Текущее состояние:**
- `collection(db, 'companies')` — плоская коллекция, все компании без фильтрации
- CRUD без проверки прав

**Что менять:**
```
Новый путь: collection(db, 'accounts', accountId, 'companies')
  - accountId берётся из AuthContext
  - Master: может передавать любой accountId → listAllAccounts() + выбор
  - Admin/User: только свой accountId

Удалить: addCompany, deleteCompany для role='user'
  - Только admin и master могут создавать/удалять компании
```

**Без downtime:** старая коллекция `companies/` остаётся, читается параллельно пока не мигрирует.

---

### 3. api.ts (`src/data/api.ts`)

**Текущее состояние:**
- `collection(db, 'invoices')` с `where('companyId', '==', companyId)` — уже есть фильтрация!
- `collection(db, 'bank_transactions')` с `where('companyId', '==', companyId)` — тоже есть
- `config/global_ai_rules` — глобальные, без изоляции

**Что менять:**
```
Инвойсы: путь меняется на subcollection:
  accounts/{accountId}/companies/{companyId}/invoices/{invoiceId}
  
  ИЛИ — оставить плоскую коллекцию invoices/ и добавить поле accountId
  (рекомендую второй вариант — меньше изменений в коде + индексы работают)

bank_transactions: аналогично — добавить поле accountId, фильтровать по нему

Global AI rules: перенести под accounts/{accountId}/settings/ai_rules
  Старые config/global_ai_rules → используем как fallback при отсутствии account-specific rules
```

**Рекомендация:** НЕ переходить на subcollection для invoices/bank_transactions — слишком много мест в коде. Добавить поле `accountId` и индекс — это backward-compatible изменение.

---

### 4. imap_daemon.cjs (`automation/imap_daemon.cjs`)

**Текущее состояние:**
- `const IDEACOM_ID = 'vlhvA6i8d3Hry8rtrA3Z'` — захардкожен для fallback правила извлечения
- `db.collection('companies').get()` — загружает ВСЕ компании без фильтра
- `config/global_ai_rules` — глобальные правила

**Что менять:**
```
1. IDEACOM_ID убрать → правило "Ideacom is vendor, not receiver" перенести в 
   companies/{ideacomId}.vendorRule или в teacher_global_rules Ideacom-документ

2. Загрузка компаний: итерация по аккаунтам
   const accounts = await db.collection('accounts').get()
   for (const account of accounts.docs) {
     const companies = await db.collection('accounts').doc(account.id)
       .collection('companies').where('imapHost', '!=', null).get()
     // обработка
   }

3. global_ai_rules → загружать per-account:
   accounts/{accountId}/settings/ai_rules
   fallback: config/global_ai_rules (глобальные)
```

---

### 5. api_server.cjs (`automation/api_server.cjs`)

**Текущее состояние:**
- **НЕТ аутентификации** — все эндпоинты открыты (только IP rate limit)
- `/api/chat`, `/api/invalidate-cache` без проверки токена

**Что добавить:**
```javascript
// Middleware для всех /api/* роутов:
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const decoded = await admin.auth().verifyIdToken(token)
  req.uid = decoded.uid
  req.email = decoded.email
  // Проверить роль в accounts или system/master_users
  next()
}

// Для /api/chat — проверять что accountId в теле запроса 
// совпадает с accountId пользователя (или user is master)
```

**Риск:** Frontend сейчас не передаёт Authorization header — нужно добавить одновременно с backend.

---

### 6. Firestore Security Rules (`firestore.rules`)

**Текущее состояние:**
```
match /{document=**} { allow read, write: if isAdmin(); }
```
Любой bootstrap admin видит и меняет ВСЁ. Нет isolation между аккаунтами.

**Новые правила:**
```javascript
function isMaster() {
  return exists(/databases/$(database)/documents/system/master_users/$(request.auth.uid))
}

function isAccountAdmin(accountId) {
  return get(/databases/$(database)/documents/accounts/$(accountId)/users/$(request.auth.uid)).data.role == 'admin'
}

function isAccountMember(accountId) {
  return exists(/databases/$(database)/documents/accounts/$(accountId)/users/$(request.auth.uid))
}

// Invoices (плоская коллекция с полем accountId)
match /invoices/{invoiceId} {
  allow read: if isMaster() || isAccountMember(resource.data.accountId)
  allow write: if isMaster() || isAccountMember(resource.data.accountId)
}

// Компании внутри аккаунта
match /accounts/{accountId}/companies/{companyId} {
  allow read: if isMaster() || isAccountMember(accountId)
  allow write: if isMaster() || isAccountAdmin(accountId)
}

// Управление пользователями аккаунта
match /accounts/{accountId}/users/{userId} {
  allow read: if isMaster() || isAccountMember(accountId)
  allow write: if isMaster() || isAccountAdmin(accountId)
}
```

**Риск:** `get()` в rules = дополнительные reads (тарификация). При большом трафике — оптимизировать через custom claims.

---

### 7. Миграция данных

**Существующие данные:** Global Technics + Ideacom в плоской коллекции `companies/`

**Стратегия без потерь (2 этапа):**

**Этап 1 — Создание структуры (без удаления старого):**
```
1. Создать accounts/global-technics: { name: 'Global Technics' }
2. Создать accounts/global-technics/users/{einar_uid}: { role: 'admin' }
3. Создать accounts/global-technics/companies/{gt_companyId}: копия из companies/{GT_ID}
4. То же для Ideacom / accounts/ideacom
5. Добавить поле accountId во все invoices и bank_transactions
6. Переключить frontend на чтение из новой структуры
7. Запустить imap_daemon с новой логикой
8. Дать поработать 1 неделю параллельно
9. Удалить старую коллекцию companies/ и убрать fallback
```

**Скрипт миграции:** `automation/migrate_to_accounts.cjs`
- dry-run сначала, потом --save
- Логирует каждую операцию
- Идемпотентный (можно перезапустить)

---

### 8. Login.tsx (`src/components/Login.tsx`)

**Текущее состояние:**
- Только кнопка Google Sign In
- Выбор языка

**Что добавить:**
```
1. Перед кнопкой Google: input "Название аккаунта"
   - Autocomplete по accounts/ коллекции (только name, без секретов)
   - Или dropdown если аккаунтов мало
   - Для мастера: кнопка "Войти как мастер" (без ввода аккаунта)

2. После входа Google:
   - Мастер → список аккаунтов (AccountSelector компонент)
   - Обычный пользователь → сразу на дашборд своего аккаунта
   - Нет доступа → сообщение "Обратитесь к администратору аккаунта {name}"
```

---

## РИСКИ

| Риск | Серьёзность | Митигация |
|------|-------------|-----------|
| Firestore rules `get()` = N reads за запрос | Средний | Custom claims после запуска |
| imap_daemon итерирует аккаунты → N×M API calls | Средний | Concurrency limit (p-limit) |
| Frontend не передаёт Bearer token на backend | Высокий | Делать одновременно с backend auth |
| Дублирование данных при миграции (invoices без accountId) | Высокий | Скрипт с проверкой + dry-run |
| Старые automation скрипты ломаются | Низкий | Оставить fallback на GT_COMPANY_ID |

---

## ПОРЯДОК РЕАЛИЗАЦИИ (по фазам)

### Фаза 1 — Фундамент (без downtime)
1. Создать `system/master_users/{uid}` в Firestore
2. Создать accounts структуру для GT и Ideacom
3. Написать migrate_to_accounts.cjs (dry-run)
4. Обновить Firestore Rules — добавить isMaster/isAccountMember НЕ удаляя старые
5. Добавить поле `accountId` в invoices/bank_transactions (backfill скрипт)

### Фаза 2 — Frontend (можно деплоить поэтапно)
1. Login.tsx: добавить поле аккаунта (hidden для мастера)
2. AuthContext.tsx: логика трёх ролей
3. useCompanies.ts: фильтрация по accountId
4. api.ts: добавить accountId в запросы (backward-compatible)

### Фаза 3 — Backend
1. api_server.cjs: auth middleware
2. webhook_server.cjs: auth middleware  
3. imap_daemon.cjs: убрать IDEACOM_ID, итерация по аккаунтам

### Фаза 4 — Cleanup
1. Удалить старую коллекцию companies/
2. Удалить захардкоженные email в AuthContext
3. Убрать `VITE_ALLOWED_EMAILS` (заменить на Firestore-based доступ)
4. Обновить Firestore Rules — убрать старые bootstrap admin правила

### Что требует downtime:
- **Ничего** — если делать поэтапно с backward-compatible изменениями

### Что нельзя делать до фазы 4:
- Удалять `config/admin_emails` и `VITE_ALLOWED_EMAILS` — fallback до перехода

---

DEPLOY_STATUS: OK
