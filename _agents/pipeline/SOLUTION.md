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

### INVOICES SAMPLE
```
companyId:bP6dc0PMdFtnmS5QTX4N(Global Technics OÜ) → 3 invoices
  vendor:JAL RE-EST CZECH GRO
  vendor:Allstore Assets OÜ
  vendor:Zone Media OÜ
companyId:vlhvA6i8d3Hry8rtrA3Z(Ideacom OÜ) → 3 invoices
  vendor:LHV
  vendor:UAB "Ursus LT"
  vendor:UAB "Ursus LT"
```

## ВЫВОД

**Данные в Firestore корректны.** Каждая компания хранится в двух местах (accounts/X/companies/ и top-level companies/) с одинаковыми ID. Инвойсы привязаны к правильным companyId.

**Проблема в frontend.** Нужно проверить логику фильтрации — как компонент выбирает какой companyId передавать в запрос Firestore при переключении аккаунта в дропдауне.

DEPLOY_STATUS: OK
