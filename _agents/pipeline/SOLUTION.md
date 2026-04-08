# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-11 — Мягкое удаление инвойсов (архив вместо delete)

## ЗАДАНИЕ

Мягкое удаление инвойсов (архив вместо delete)

## Что сделано

### Мягкое удаление (реализовано в кодовой базе):
- `src/data/types.ts` — поля `archived?: boolean` и `deletedAt?: any` в типе `Invoice`
- `src/data/api.ts` — функции `archiveInvoice()` и `restoreInvoice()`:
  - `archiveInvoice(id)` → `{ archived: true, deletedAt: serverTimestamp() }`
  - `restoreInvoice(id)` → `{ archived: false, deletedAt: null }`
- `src/App.tsx` — UI: две вкладки "Активные" / "📦 Архив", счётчики, кнопки, модальное подтверждение
- `src/components/InvoiceTable.tsx` — кнопка архива (активные) и кнопка восстановления (архив)
- `subscribeToInvoices()` читает поле `archived` из Firestore

### Исправлена `perplexity_review.py` (CHANGES_NEEDED из REVIEW.md):
1. `get_next_task_from_backlog()` — пустой BACKLOG → `(None, None)`, не падает
2. Валидация строки: требует `^- \[ \] TASK-\d+` (не просто `^- \[ \]`)
3. `mark_task_done_in_backlog()` — только по TASK-XX, text-match fallback убран
4. Порядок: BACKLOG помечается `[x]` только ПОСЛЕ успешной записи SOLUTION.md
5. Skip-секция: гибкий паттерн `credentials|учётные|ожидают` (case-insensitive)

## Верификация

- `npm run build` — без ошибок ✅
- `python3 -c "import ast; ast.parse(...)"` — синтаксис OK ✅
- Кнопка "В архив" → `archived: true` в Firestore, инвойс переходит в вкладку Архив
- Вкладка "📦 Архив" показывает архивированные с кнопкой восстановления
- Восстановление возвращает инвойс во вкладку Активные

DEPLOY_STATUS: OK
