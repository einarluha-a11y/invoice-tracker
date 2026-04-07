# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим — Фаза 1: Фундамент (без downtime)

## ЗАДАНИЕ

Реализуй Фазу 1 мультипользовательской архитектуры. Никакого downtime — все изменения backward-compatible.

### Шаг 1 — Создать master_users в Firestore

Через Firebase Admin SDK создай документ:
```
system/master_users/{einar_uid}
  email: "einar.luha@gmail.com"
  createdAt: timestamp
```

Einar uid — получи из Firebase Auth через:
```js
const user = await admin.auth().getUserByEmail('einar.luha@gmail.com')
console.log(user.uid)
```

### Шаг 2 — Создать accounts структуру

Создай два аккаунта в Firestore:

```
accounts/global-technics/
  name: "Global Technics"
  createdAt: timestamp
  users/{einar_uid}/
    email: "einar.luha@gmail.com"
    role: "admin"
    addedAt: timestamp

accounts/ideacom/
  name: "Ideacom"
  createdAt: timestamp
  users/{einar_uid}/
    email: "einar.luha@gmail.com"
    role: "admin"
    addedAt: timestamp
```

Для каждого аккаунта также создай subcollection companies/ скопировав данные из существующих companies/{GT_ID} и companies/{IDEACOM_ID}:
```
accounts/global-technics/companies/{GT_ID}/ → копия из companies/{GT_ID}
accounts/ideacom/companies/{IDEACOM_ID}/ → копия из companies/{IDEACOM_ID}
```

### Шаг 3 — Написать migrate_to_accounts.cjs

Создай файл `automation/migrate_to_accounts.cjs`:

```js
/**
 * Миграция данных для мультипользовательского режима.
 * Добавляет поле accountId в invoices и bank_transactions.
 * 
 * Запуск:
 *   node migrate_to_accounts.cjs --dry-run   (только показывает что будет)
 *   node migrate_to_accounts.cjs --save       (реально меняет)
 */
```

Скрипт должен:
1. Загрузить все компании из `companies/`
2. Определить accountId для каждой компании по её полю (GT_ID → 'global-technics', IDEACOM_ID → 'ideacom')
3. Найти все инвойсы этой компании в `invoices/`
4. Добавить поле `accountId` если его нет
5. То же для `bank_transactions/`
6. Логировать каждую операцию
7. Быть идемпотентным (пропускать уже обновлённые документы)

Сначала запусти с `--dry-run`, покажи результат, потом с `--save`.

### Шаг 4 — Обновить Firestore Security Rules

Добавить новые правила НЕ удаляя старые (в `firestore.rules`):

```javascript
function isMaster() {
  return exists(/databases/$(database)/documents/system/master_users/$(request.auth.uid));
}

function isAccountMember(accountId) {
  return exists(/databases/$(database)/documents/accounts/$(accountId)/users/$(request.auth.uid));
}

function isAccountAdmin(accountId) {
  return get(/databases/$(database)/documents/accounts/$(accountId)/users/$(request.auth.uid)).data.role == 'admin';
}

// Добавить к существующим правилам:
match /accounts/{accountId} {
  allow read: if request.auth != null && (isMaster() || isAccountMember(accountId));
  allow write: if request.auth != null && (isMaster() || isAccountAdmin(accountId));
}

match /accounts/{accountId}/users/{userId} {
  allow read: if request.auth != null && (isMaster() || isAccountMember(accountId));
  allow write: if request.auth != null && (isMaster() || isAccountAdmin(accountId));
}

match /accounts/{accountId}/companies/{companyId} {
  allow read: if request.auth != null && (isMaster() || isAccountMember(accountId));
  allow write: if request.auth != null && (isMaster() || isAccountAdmin(accountId));
}

match /system/master_users/{userId} {
  allow read: if request.auth != null;
  allow write: if false; // только через Admin SDK
}
```

Задеплой правила: `firebase deploy --only firestore:rules`

### Верификация

- Проверь что master_users/{uid} создан
- Проверь что accounts/global-technics и accounts/ideacom существуют
- Запусти migrate_to_accounts.cjs --dry-run — покажи результат
- Запусти migrate_to_accounts.cjs --save
- Проверь что 5 случайных инвойсов имеют поле accountId
- `firebase deploy --only firestore:rules` прошёл без ошибок
