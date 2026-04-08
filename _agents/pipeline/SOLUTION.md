# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-22 — Жёсткое разделение баз данных по компаниям

## ВЫПОЛНЕНО

### Диагностика (Шаг 1)

Результат:
```
ACCOUNT: global-technics → Global Technics
  COMPANY: bP6dc0PMdFtnmS5QTX4N → Global Technics OÜ (invoices@gltechnics.com)
ACCOUNT: ideacom → Ideacom
  COMPANY: vlhvA6i8d3Hry8rtrA3Z → Ideacom OÜ (invoices@ideacom.ee)
INVOICE companyId: bP6dc0PMdFtnmS5QTX4N (GT инвойсы)
INVOICE companyId: vlhvA6i8d3Hry8rtrA3Z (Ideacom инвойсы)
```

Данные правильно разделены. Проблема была ТОЛЬКО в нестабильном fallback коде.

### Убран fallback из useCompanies.ts (Шаг 2)

Удалена вся логика getDocs + fallback на top-level `companies/` коллекцию (было строки 57-99).
Теперь: прямой `onSnapshot` на `accounts/${currentAccountId}/companies` без промежуточных шагов.

Было:
```ts
getDocs(accountPath)
  .then(snap => snap.empty ? fallback('companies') : subscribe(accountPath))
  .catch(() => fallback('companies'))
```

Стало:
```ts
onSnapshot(collection(db, `accounts/${currentAccountId}/companies`), ...)
```

### App.tsx (Шаг 3) — уже корректен

- `useEffect(() => setSelectedCompanyId(''), [currentAccountId])` — сброс при смене аккаунта ✓
- Авто-выбор первой компании после загрузки ✓
- Account selector явно сбрасывает `selectedCompanyId` при переключении ✓

## DEPLOY_STATUS: OK

npm run build — чистый, без ошибок TypeScript.
Fallback на общую коллекцию полностью убран.
Переключение аккаунтов теперь стабильно — нет async гонки.
