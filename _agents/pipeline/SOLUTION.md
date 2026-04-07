# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-06 — Рефакторинг updateInvoice() — разбить 359 строк на функции

## ЗАДАНИЕ

src/data/api.ts строки 156-514 — функция updateInvoice() делает 6 разных вещей. Разбить на отдельные функции.

### Новые функции (в том же файле api.ts):

1. `saveInvoiceToDb(invoice, companyId)` — только запись в Firestore
2. `saveTeacherExample(invoice, companyId)` — запись примера для Teacher
3. `updateVendorProfile(invoice, companyId)` — обновление профиля вендора
4. `generateGlobalRules(invoice, companyId)` — генерация правил
5. `reconcileWithBankStatement(invoice, companyId)` — сверка с банком

`updateInvoice()` остаётся как оркестратор который вызывает все пять последовательно.

### Правила рефакторинга:
- Не менять внешний интерфейс updateInvoice() — только внутренняя декомпозиция
- Каждая функция — одна ответственность, 30-80 строк максимум
- Сохранить всю существующую логику без изменений
- Добавить JSDoc комментарий к каждой новой функции

### Верификация:
- `npm run build` без ошибок TypeScript
- Поведение updateInvoice() идентично до и после
