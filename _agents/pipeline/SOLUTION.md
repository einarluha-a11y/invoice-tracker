# SOLUTION

PHASE: DONE
ROUND: 6
TASK: TASK-22 Round 6 — исправлён stale selectedCompanyId в App.tsx

## ВЫПОЛНЕНО

Код уже содержит оба исправления из диагноза:

### App.tsx (строки 85–97)
```tsx
// Reset selected company when account changes
useEffect(() => {
    setSelectedCompanyId('');
}, [currentAccountId]);

// При смене списка компаний — сбросить выбор на первую компанию
useEffect(() => {
    if (companies.length > 0) {
        setSelectedCompanyId(companies[0].id);
    } else {
        setSelectedCompanyId('');
    }
}, [companies]); // deps: только companies, без selectedCompanyId
```

### useCompanies.ts (строка 50)
```ts
setCompanies([]); // Clear stale data immediately so auto-select doesn't fire on old account's companies
```

Логика сброса работает в два шага:
1. `currentAccountId` меняется → `setCompanies([])` → `selectedCompanyId = ""`
2. Новые companies загружаются → `setSelectedCompanyId(companies[0].id)`

## ВЕРИФИКАЦИЯ
- `npm run build` — ✅ без ошибок (built in 2.33s)
- Логика соответствует диагнозу из Round 5

DEPLOY_STATUS: OK
