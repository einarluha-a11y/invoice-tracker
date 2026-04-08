# SOLUTION

PHASE: DONE
ROUND: 3
TASK: TASK-22 Round 3 — При переключении компании инвойсы не перегружаются

## СИМПТОМ

Открытие → Ideacom окно + Ideacom инвойсы ✅
Переключение на GT → GT окно + Ideacom инвойсы ❌

## ПРИЧИНА

При переключении компании selectedCompanyId не обновляется.
Инвойсы продолжают загружаться для старого companyId.

## ИСПРАВЛЕНИЕ

В App.tsx (строки 90-97) заменён useEffect:

**Было:**
```tsx
useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
        setSelectedCompanyId(companies[0].id);
    }
}, [companies, selectedCompanyId]);
```

**Стало:**
```tsx
useEffect(() => {
    if (companies.length > 0) {
        setSelectedCompanyId(companies[0].id);
    } else {
        setSelectedCompanyId('');
    }
}, [companies]);
```

Убрана условность `!selectedCompanyId` — теперь при любом изменении
списка компаний (смена аккаунта) selectedCompanyId безусловно сбрасывается
на первую компанию нового аккаунта.

## Верификация
- Открыть → Ideacom → инвойсы Ideacom ✅
- Переключить на GT → инвойсы GT ✅
- Переключить обратно на Ideacom → инвойсы Ideacom ✅

DEPLOY_STATUS: OK
