# SOLUTION

PHASE: ARCHITECTURE
ROUND: 6
TASK: TASK-22 Round 6 — исправить stale selectedCompanyId в App.tsx

## ДИАГНОЗ (подтверждён)

Данные в Firestore корректны — GT 103 инвойса, Ideacom 64.
Проблема: selectedCompanyId не сбрасывается когда companies[] меняется.

## ИСПРАВЛЕНИЕ в App.tsx

Найди useEffect который устанавливает selectedCompanyId по умолчанию.
Сейчас он скорее всего выглядит так:
```tsx
useEffect(() => {
  if (!selectedCompanyId && companies.length > 0) {
    setSelectedCompanyId(companies[0].id);
  }
}, [companies, selectedCompanyId]);
```

Проблема: условие `!selectedCompanyId` не позволяет обновить при смене аккаунта.

ИСПРАВИТЬ на:
```tsx
useEffect(() => {
  if (companies.length > 0) {
    // Всегда сбрасывать на первую компанию нового аккаунта
    setSelectedCompanyId(companies[0].id);
  } else {
    setSelectedCompanyId("");
  }
}, [companies]); // НЕ включать selectedCompanyId в deps
```

Также убедиться что при смене currentAccountId в AuthContext
companies сбрасывается в [] сначала — это заставит useEffect сработать дважды:
1. companies=[] → selectedCompanyId=""
2. companies=[GT компании] → selectedCompanyId=GT_ID

Если companies не сбрасывается — добавить в useCompanies.ts:
```ts
// При смене currentAccountId — немедленно очистить список
useEffect(() => {
  setCompanies([]);
}, [currentAccountId]);
```

## Верификация
- Открыть → первая компания правильная ✅
- Переключить на другую → инвойсы сменились ✅
- Переключить обратно → снова правильно ✅
- npm run build без ошибок ✅

