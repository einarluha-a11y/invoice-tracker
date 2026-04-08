# SOLUTION

PHASE: COMPLETED
ROUND: 1
TASK: TASK-21 — СРОЧНО: перепутаны инвойсы Global Technics и Ideacom

## ДИАГНОСТИКА

Firestore данные **в порядке**:
- `accounts/global-technics` → компания `bP6dc0PMdFtnmS5QTX4N` (Global Technics OÜ)
- `accounts/ideacom` → компания `vlhvA6i8d3Hry8rtrA3Z` (Ideacom OÜ)
- Инвойсы GT: `companyId=bP6dc0PMdFtnmS5QTX4N`, инвойсы Ideacom: `companyId=vlhvA6i8d3Hry8rtrA3Z`

## ПРИЧИНА (Вариант В — код)

`App.tsx` строки 86–90: при смене аккаунта `selectedCompanyId` **не сбрасывался**.

```tsx
// БЫЛО — условие не срабатывало при смене аккаунта:
useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
        setSelectedCompanyId(companies[0].id);
    }
}, [companies, selectedCompanyId]);
```

Сценарий баги:
1. Выбран Global Technics → `selectedCompanyId = "bP6dc0PMdFtnmS5QTX4N"`
2. Переключаемся на Ideacom → companies обновляется, но `selectedCompanyId` не пуст
3. Условие `!selectedCompanyId` = false → ID не меняется
4. `subscribeToInvoices("bP6dc0PMdFtnmS5QTX4N")` → показывает инвойсы GT при выбранном Ideacom

## ИСПРАВЛЕНИЕ

Добавлен `useEffect` сброса `selectedCompanyId` при смене `currentAccountId`:

```tsx
// ДОБАВЛЕНО:
useEffect(() => {
    setSelectedCompanyId('');
}, [currentAccountId]);
```

## DEPLOY_STATUS: OK

Коммит: `315a4fe` — задеплоен через Railway auto-deploy (push в main).
