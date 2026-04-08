# SOLUTION

PHASE: ARCHITECTURE
ROUND: 5
TASK: TASK-22 Round 5 — диагностика companyId в Firestore (проблема НЕ исправлена)

## ФАКТ

На дашборде по-прежнему: GT окно → Ideacom инвойсы, Ideacom окно → GT инвойсы.
Предыдущие фиксы не помогли. Нужна диагностика реальных данных.

## ЗАПУСТИ ЭТО и запиши вывод в STATUS.md

```js
// save as diag.cjs и запусти: node diag.cjs
require("dotenv").config({ path: ".env.production" });
const { db } = require("./automation/core/firebase.cjs");

(async () => {
  // 1. Компании в accounts/
  console.log("\n=== ACCOUNTS/COMPANIES ===");
  const accs = await db.collection("accounts").get();
  for (const acc of accs.docs) {
    const cos = await acc.ref.collection("companies").get();
    for (const co of cos.docs) {
      console.log(`account:${acc.id} | company_id:${co.id} | name:${co.data().name}`);
    }
  }

  // 2. Старые компании
  console.log("\n=== TOP-LEVEL COMPANIES ===");
  const oldCos = await db.collection("companies").get();
  oldCos.docs.forEach(c => console.log(`id:${c.id} | name:${c.data().name}`));

  // 3. Первые 5 инвойсов каждой компании
  console.log("\n=== INVOICES SAMPLE ===");
  const cos2 = await db.collection("companies").get();
  for (const co of cos2.docs) {
    const invs = await db.collection("invoices").where("companyId","==",co.id).limit(3).get();
    console.log(`companyId:${co.id}(${co.data().name}) → ${invs.size} invoices`);
    invs.docs.forEach(i => console.log(`  vendor:${(i.data().vendorName||"").substring(0,20)}`));
  }
})();
```

## После запуска

Запиши полный вывод в STATUS.md и сделай commit.
НЕ исправляй ничего — только диагностика.

