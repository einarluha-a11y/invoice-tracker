# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-21 — СРОЧНО: перепутаны инвойсы Global Technics и Ideacom

## ПРОБЛЕМА

На дашборде при выборе "Global Technics" показываются инвойсы Ideacom и наоборот.

## ДИАГНОСТИКА — сделай в первую очередь

1. Проверь в Firestore что лежит в accounts/:
```js
const snap = await db.collection("accounts").get();
snap.docs.forEach(d => console.log(d.id, d.data().name));
```
Ожидаем: "global-technics" → "Global Technics", "ideacom" → "Ideacom"

2. Проверь companyId в инвойсах:
```js
const inv = await db.collection("invoices").limit(5).get();
inv.docs.forEach(d => console.log(d.data().companyId, d.data().vendorName));
```

3. Проверь что в accounts/global-technics/companies/ лежит правильная компания
и в accounts/ideacom/companies/ — правильная.

## ВЕРОЯТНЫЕ ПРИЧИНЫ

**А) Маппинг перепутан при миграции** — accountId "global-technics" указывает
на компанию с данными Ideacom в Firestore.

**Б) localStorage** — `currentAccountId` сохранён неверно, фронтенд
грузит данные не той компании.

**В) useCompanies fallback** — старая коллекция `companies/` возвращает
компании в другом порядке чем новая `accounts/{id}/companies/`.

## ИСПРАВЛЕНИЕ

После диагностики — исправить маппинг в Firestore или в коде.
Если перепутан маппинг в accounts/ структуре — пересоздать правильно.

## Верификация
- Выбрать Global Technics → видны инвойсы GT (проверить по vendorName)
- Выбрать Ideacom → видны инвойсы Ideacom

