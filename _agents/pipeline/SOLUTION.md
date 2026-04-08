# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-22 — Жёсткое разделение баз данных по компаниям

## ВЫПОЛНЕНО

### Диагностика
- Аккаунт `global-technics` → компания `bP6dc0PMdFtnmS5QTX4N` (Global Technics OÜ)
- Аккаунт `ideacom` → компания `vlhvA6i8d3Hry8rtrA3Z` (Ideacom OÜ)
- Все инвойсы имеют правильный `companyId`, смешивания данных нет
- Структура `accounts/{id}/companies/` заполнена корректно

### Исправление useCompanies.ts
Удалён весь fallback на корневую коллекцию `companies/`:
- Убран `getDocs` + условный `usePath`
- Убран `.catch` с fallback на `collection(db, 'companies')`
- Теперь всегда читаем только `accounts/{currentAccountId}/companies/`
- Если `currentAccountId` нет — пустой массив, без fallback
- Убран неиспользуемый импорт `getDocs`

### App.tsx — цепочка selectedCompanyId
Проверено — уже корректна:
- `useEffect([currentAccountId])` → сбрасывает `selectedCompanyId` при смене аккаунта
- Selector аккаунта → явный `setSelectedCompanyId` при выборе
- Auto-select первой компании при загрузке

### Сборка
- `npm run build` — без ошибок
- Нет TS ошибок

## DEPLOY_STATUS: OK

## Следующий шаг (опционально)
- Обновить Firestore rules чтобы блокировать cross-company чтение на уровне БД
- Но это уже не критично — физической утечки данных нет, companyId в запросах корректны
