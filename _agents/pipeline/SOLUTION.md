# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-22 — Жёсткое разделение баз данных по компаниям

## ПРОБЛЕМА

Переключение компаний нестабильно — иногда показывает правильные инвойсы, иногда нет.
Три корневые причины:

1. useCompanies.ts имеет fallback на старую коллекцию companies/ (строки 57-95)
2. Инвойсы читаются через мягкий фильтр where(companyId) — не физическая изоляция
3. companyId может не совпадать между аккаунтами

## ШАГ 1 — Диагностика (запусти и покажи вывод)

```js
// node диагностика прямо в проекте
const admin = require("./automation/core/firebase.cjs");
const db = admin.db || admin.firestore;

const accounts = await db.collection("accounts").get();
for (const acc of accounts.docs) {
  console.log("ACCOUNT:", acc.id, acc.data().name);
  const companies = await acc.ref.collection("companies").get();
  for (const c of companies.docs) {
    console.log("  COMPANY:", c.id, c.data().name, c.data().emailAddress);
  }
}

const inv = await db.collection("invoices").limit(5).get();
inv.docs.forEach(d => console.log("INVOICE companyId:", d.data().companyId, "vendor:", d.data().vendorName?.substring(0,20)));
```

## ШАГ 2 — Убрать fallback из useCompanies.ts

Строки 57-95: удалить весь блок fallback на старую коллекцию companies/.
Оставить только: если currentAccountId есть — читаем accounts/{currentAccountId}/companies/
Если нет — пустой массив.

## ШАГ 3 — Проверить цепочку selectedCompanyId

В App.tsx убедиться что при переключении аккаунта selectedCompanyId сбрасывается
и устанавливается заново из нового списка компаний.

## Верификация
- Переключить GT → Ideacom → GT 5 раз подряд
- Каждый раз правильные инвойсы
- npm run build без ошибок

