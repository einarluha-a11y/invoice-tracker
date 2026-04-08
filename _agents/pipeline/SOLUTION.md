# SOLUTION

PHASE: COMPLETED
ROUND: 1
TASK: TASK-21 — СРОЧНО: перепутаны инвойсы Global Technics и Ideacom

## ДИАГНОСТИКА

**Firestore данные — верные:**
- `accounts/global-technics/companies/bP6dc0PMdFtnmS5QTX4N` → Global Technics OÜ ✓
- `accounts/ideacom/companies/vlhvA6i8d3Hry8rtrA3Z` → Ideacom OÜ ✓
- Инвойсы: `companyId` правильно соответствует `accountId`
- Всего: 103 инвойса GT, 64 Ideacom — все с правильным companyId

**Причина бага — два дефекта в `src/hooks/useCompanies.ts`:**

### Дефект 1 — стейл данные (ГЛАВНЫЙ)
При смене `currentAccountId` хук НЕ очищал `companies` немедленно.
Auto-select в App.tsx срабатывал на СТАРЫХ компаниях (от предыдущего аккаунта)
и устанавливал неправильный `selectedCompanyId`. Когда новые компании
загружались, auto-select уже не срабатывал (`!selectedCompanyId` = false).

Результат: пользователь видит "Global Technics" в dropdown, но
`selectedCompanyId` = ID от Ideacom → показываются чужие инвойсы.

### Дефект 2 — race condition
`getDocs` промис не отменялся при смене аккаунта. Стейлный промис
от предыдущего аккаунта мог resolve-нуться позже нового и перезаписать
правильные компании.

## ИСПРАВЛЕНИЕ

`src/hooks/useCompanies.ts`:
1. Добавлено `setCompanies([])` сразу после смены аккаунта (до async операции)
2. Добавлен флаг `cancelled = true` в cleanup функцию — все callbacks
   от стейлных промисов теперь игнорируются

## DEPLOY_STATUS: OK

Коммит: 3da8cbc — запушено в main → Railway деплоится автоматически.

## Верификация
- Выбрать Global Technics → показываются инвойсы GT (JAL RE-EST, Allstore, Tele2 и т.д.)
- Выбрать Ideacom → показываются инвойсы Ideacom (UAB Ursus, PRONTO, LHV и т.д.)
- Быстрое переключение между аккаунтами — данные всегда правильные
