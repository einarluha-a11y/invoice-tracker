# SOLUTION

PHASE: ARCHITECTURE
ROUND: 4
TASK: TASK-22 Round 4 — companyId перепутан в Firestore (инвойсы GT показываются в Ideacom и наоборот)

## ТОЧНЫЙ СИМПТОМ

- Открытие → окно Ideacom + инвойсы GT ❌
- Переключение на GT → окно GT + инвойсы Ideacom ❌

Это значит companyId в инвойсах перепутан — инвойсы GT записаны с companyId от Ideacom и наоборот.

## ДИАГНОСТИКА — запусти и покажи вывод

```js
const { db } = require("./automation/core/firebase.cjs");

// 1. Смотрим companyId компаний
const snap = await db.collection("accounts").get();
for (const acc of snap.docs) {
  const companies = await acc.ref.collection("companies").get();
  for (const c of companies.docs) {
    console.log(`ACCOUNT: ${acc.id} | COMPANY_DOC_ID: ${c.id} | NAME: ${c.data().name}`);
  }
}

// 2. Смотрим что записано в инвойсах
const inv = await db.collection("invoices").limit(10).get();
inv.docs.forEach(d => {
  console.log(`INVOICE companyId: ${d.data().companyId} | vendor: ${(d.data().vendorName||"").substring(0,25)}`);
});
```

## ОЖИДАЕМЫЙ РЕЗУЛЬТАТ ДИАГНОСТИКИ

Если companyId в инвойсах не совпадает с ID компании в accounts/ — нужно исправить в Firestore.
Если совпадает — проблема в том как фронтенд маппит companyId на название.

## ИСПРАВЛЕНИЕ (после диагностики)

Вариант А: если companyId перепутан в инвойсах → написать скрипт который меняет companyId у всех инвойсов.

Вариант Б: если маппинг компаний неверный → исправить в accounts/ структуре.

## Верификация
- Ideacom окно → инвойсы Ideacom ✅
- GT окно → инвойсы GT ✅
- Переключить 5 раз подряд — всегда правильно ✅

