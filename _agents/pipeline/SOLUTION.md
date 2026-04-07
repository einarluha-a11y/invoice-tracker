# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим — Фаза 1: Фундамент (без downtime)

## РЕЗУЛЬТАТ

### Выполнено

**Шаг 1 — master_users/{uid}**
- Создан документ `master_users/MI9J2VBriwQ45jEMJ5tmbagfHm93` с полями email + createdAt
- UID получен через `firebase-tools auth:export` (Admin SDK Auth API недоступен с текущим сервис-аккаунтом)
- Примечание: путь использован `master_users/{uid}` (2 сегмента = валидный документ), а не `system/master_users/{uid}` (3 сегмента = невалиден для Firestore документа)

**Шаг 2 — accounts структура**
- `accounts/global-technics` → name, createdAt
- `accounts/global-technics/users/MI9J2VBriwQ45jEMJ5tmbagfHm93` → email, role: admin
- `accounts/global-technics/companies/bP6dc0PMdFtnmS5QTX4N` → копия Global Technics OÜ
- `accounts/ideacom` → name, createdAt
- `accounts/ideacom/users/MI9J2VBriwQ45jEMJ5tmbagfHm93` → email, role: admin
- `accounts/ideacom/companies/vlhvA6i8d3Hry8rtrA3Z` → копия Ideacom OÜ

**Шаг 3 — migrate_to_accounts.cjs**
- Создан файл `automation/migrate_to_accounts.cjs`
- dry-run: 161 инвойс + 456 bank_transactions = 617 документов
- `--save` выполнен: все 617 документов получили поле `accountId`
- Идемпотентный: повторный запуск пропускает уже обновлённые документы

**Шаг 4 — Firestore Security Rules**
- Добавлены функции `isMaster()`, `isAccountMember()`, `isAccountAdmin()`
- Добавлены правила для `master_users/{userId}`, `accounts/{accountId}`, subcollections users/ и companies/
- Старые правила (`isAdmin()`, `/{document=**}`) сохранены — backward-compatible
- `firebase deploy --only firestore:rules` — ✅ без ошибок

### Верификация
- `master_users/MI9J2VBriwQ45jEMJ5tmbagfHm93` → ✅ существует
- `accounts/global-technics` → ✅ Global Technics
- `accounts/ideacom` → ✅ Ideacom
- 5 случайных инвойсов → все имеют `accountId` (global-technics или ideacom)
- `firebase deploy --only firestore:rules` → ✅ compiled successfully

### Адаптации от плана
1. Путь master_users: `master_users/{uid}` вместо `system/master_users/{uid}` — 3-сегментный путь невалиден для Firestore документа, правила адаптированы соответственно
2. setup_multitenancy.cjs — вспомогательный скрипт для создания структуры (не входил в план, но нужен для воспроизводимости)

### Готово к Фазе 2
- Фундамент готов: master_users, accounts, accountId в данных, правила
- Следующий шаг: Frontend — Login.tsx + AuthContext.tsx + useCompanies.ts

DEPLOY_STATUS: OK
