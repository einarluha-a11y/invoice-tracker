# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: TASK-22 Round 5 — диагностика завершена

## РЕЗУЛЬТАТЫ ДИАГНОСТИКИ

### ACCOUNTS/COMPANIES
```
account:global-technics | company_id:bP6dc0PMdFtnmS5QTX4N | name:Global Technics OÜ
account:ideacom          | company_id:vlhvA6i8d3Hry8rtrA3Z | name:Ideacom OÜ
```

### TOP-LEVEL COMPANIES
```
id:bP6dc0PMdFtnmS5QTX4N | name:Global Technics OÜ
id:vlhvA6i8d3Hry8rtrA3Z | name:Ideacom OÜ
```

### INVOICES FULL COUNT
```
companyId:bP6dc0PMdFtnmS5QTX4N (Global Technics OÜ) → 103 invoices
  top vendors: Täisteenusliisingu AS:18, Allstore Assets OÜ:15, SIA Citadele Leasing:9, ESTMA Terminaali:9, Tele2 Eesti:8

companyId:vlhvA6i8d3Hry8rtrA3Z (Ideacom OÜ) → 64 invoices
  top vendors: PRONTO Sp. z o.o.:15, UAB "Ursus LT":8, SIA Citadele Leasing:5, Alexela AS:5, LHV:4
```

## ВЫВОД

**Данные в Firestore корректны.** Subcollection IDs совпадают с top-level company IDs. Инвойсы (103 GT + 64 Ideacom) привязаны к правильным companyId. Перепутывания нет.

**Проблема в frontend.** Возможные причины:
1. `useCompanies` читает из `accounts/{accountId}/companies` → subcollection ID = `d.id` (document ID) → это правильный companyId
2. `getInvoices(selectedCompanyId)` запрашивает `where('companyId', '==', selectedCompanyId)` — должно работать
3. Возможно: при переключении аккаунта `selectedCompanyId` не сбрасывается вовремя → стале значение из предыдущего аккаунта
4. Проверить: `companies.length > 0` → `setSelectedCompanyId(companies[0].id)` — порядок companies в массиве

DEPLOY_STATUS: OK
