# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-22 — Жёсткое разделение баз данных по компаниям

## КОРНЕВЫЕ ПРОБЛЕМЫ (найдены аудитом)

### ПРОБЛЕМА 1 — Инвойсы в общей коллекции (главная причина нестабильности)

Сейчас: `collection(db, "invoices")` + `where("companyId", "==", companyId)`
Это мягкая фильтрация — при малейшей ошибке companyId данные смешиваются.

Правильно: `collection(db, "companies", companyId, "invoices")`
Каждая компания имеет свою подколлекцию — физическая изоляция.

### ПРОБЛЕМА 2 — Нестабильный fallback в useCompanies.ts

Строки 57-95: код сначала пробует `accounts/{accountId}/companies/`,
при ошибке падает на `companies/` (старая коллекция).
Это создаёт непредсказуемое поведение — иногда загружает правильно, иногда нет.

### ПРОБЛЕМА 3 — Firestore rules не блокируют cross-company чтение

Текущие rules разрешают читать из `invoices/` если пользователь авторизован.
Нет проверки что companyId принадлежит пользователю.

---

## ПЛАН ИСПРАВЛЕНИЯ

### Шаг 1 — Диагностика (сначала)

Запусти в Node.js и покажи результат:
```js
const { db } = require("./automation/core/firebase.cjs");

// Проверяем что лежит в accounts/
const accounts = await db.collection("accounts").get();
accounts.docs.forEach(d => {
  console.log("ACCOUNT:", d.id, "→", d.data().name);
});

// Проверяем компании в каждом аккаунте
for (const acc of accounts.docs) {
  const companies = await acc.ref.collection("companies").get();
  companies.docs.forEach(c => {
    console.log("  COMPANY:", c.id, "→", c.data().name, "email:", c.data().emailAddress);
  });
}

// Проверяем 10 инвойсов — к какой companyId относятся
const invoices = await db.collection("invoices").limit(10).get();
invoices.docs.forEach(d => {
  console.log("INVOICE:", d.data().vendorName, "companyId:", d.data().companyId);
});
```

### Шаг 2 — Убрать fallback из useCompanies.ts

Удалить всю fallback логику (строки 57-95).
Оставить только чтение из `accounts/{currentAccountId}/companies/`.
Если `currentAccountId` нет — показать пустой список, не падать на старую коллекцию.

```ts
// БЫЛО (нестабильно):
if (accountSpecificEmpty) fallback to collection(db, "companies")

// СТАЛО (жёстко):
if (!currentAccountId) { setCompanies([]); return; }
onSnapshot(collection(db, "accounts", currentAccountId, "companies"), ...)
```

### Шаг 3 — Исправить api.ts — читать инвойсы через companyId как subcollection path

Если companyId это Firestore document ID компании, инвойсы должны читаться
через компанию а не через общий фильтр.

Пока оставить `where("companyId", "==", companyId)` — это не меняем сейчас.
Главное убедиться что companyId который приходит в запрос — правильный.

### Шаг 4 — Проверить маппинг accountId → companyId

В AuthContext.tsx: `currentAccountId` это ID аккаунта (например "global-technics").
В App.tsx: `selectedCompanyId` это ID компании внутри аккаунта.
В api.ts: запрос идёт с `selectedCompanyId`.

Убедиться что цепочка не рвётся:
- currentAccountId → useCompanies загружает companies из accounts/{currentAccountId}/companies/
- companies[0].id → selectedCompanyId по умолчанию
- api.ts читает invoices where companyId == selectedCompanyId

### Шаг 5 — Обновить Firestore rules

Добавить правило что пользователь может читать инвойс только если
его companyId принадлежит его аккаунту:

```
match /invoices/{invoiceId} {
  allow read: if request.auth != null && (
    isMaster() ||
    isAdmin() ||
    resource.data.companyId in getUserCompanyIds(request.auth.uid)
  );
}
```

(getUserCompanyIds — вспомогательная функция которую нужно добавить)

## Верификация

1. Выбрать Global Technics → инвойсы только GT (проверить vendorName)
2. Выбрать Ideacom → инвойсы только Ideacom
3. Переключить несколько раз — результат должен быть стабильным каждый раз
4. В браузере DevTools → Network → Firestore запросы → убедиться что
   companyId в запросе меняется при переключении компании

