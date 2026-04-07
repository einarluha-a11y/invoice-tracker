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

## ВЫПОЛНЕНО

- `saveInvoiceToDb(invoiceId, data)` — маппинг полей, запись в Firestore, AI Self-Healing Loop ✓
- `saveTeacherExample(invoiceId, vendorName, d)` — сохранение ground-truth в `invoice_examples` ✓
- `updateVendorProfile(vendorName, d)` — профиль вендора + auto-generate Charter rules ✓
- `generateGlobalRules(d)` — паттерны VAT→currency, payment terms, tax rates в `teacher_global_rules` ✓
- `reconcileWithBankStatement(invoiceRef, d)` — сверка с `bank_transactions`, strict rules ✓
- `updateInvoice()` — оркестратор, вызывает все 5 функций последовательно, внешний интерфейс не изменён ✓
- JSDoc комментарии к каждой новой функции ✓
- `npm run build` ✓ без ошибок TypeScript

DEPLOY_STATUS: OK
