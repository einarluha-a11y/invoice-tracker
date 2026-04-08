# SOLUTION

PHASE: ARCHITECTURE
ROUND: 3
TASK: TASK-22 Round 3 — При переключении компании инвойсы не перегружаются

## СИМПТОМ

Открытие → Ideacom окно + Ideacom инвойсы ✅
Переключение на GT → GT окно + Ideacom инвойсы ❌

## ПРИЧИНА

При переключении компании selectedCompanyId не обновляется.
Инвойсы продолжают загружаться для старого companyId.

## ДИАГНОСТИКА

В App.tsx найти:
1. Где устанавливается selectedCompanyId по умолчанию
2. Есть ли useEffect который реагирует на смену companies[]
3. Как работает переключатель компании — что происходит при onChange

## ИСПРАВЛЕНИЕ

В App.tsx — добавить сброс selectedCompanyId при смене companies[]:

```tsx
// При смене списка компаний — сбросить выбор на первую компанию
useEffect(() => {
  if (companies.length > 0) {
    setSelectedCompanyId(companies[0].id);
  } else {
    setSelectedCompanyId("");
  }
}, [companies]);
```

Убедиться что этот useEffect срабатывает ПОСЛЕ того как companies обновился
при переключении аккаунта.

Также проверить — при переключении аккаунта в dropdown:
- currentAccountId меняется в AuthContext
- useCompanies загружает новый список
- useEffect выше срабатывает → selectedCompanyId обновляется
- subscribeToInvoices получает новый companyId → загружает правильные инвойсы

## Верификация
- Открыть → Ideacom → инвойсы Ideacom ✅
- Переключить на GT → инвойсы GT ✅
- Переключить обратно на Ideacom → инвойсы Ideacom ✅

