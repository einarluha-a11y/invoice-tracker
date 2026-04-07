# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мягкое удаление инвойсов (архив вместо delete)

## ЗАДАНИЕ

Реализовать **мягкое удаление** инвойсов вместо жесткого DELETE:

1. **Backend API** (`src/lib/invoices.ts`):
   - `archiveInvoice(id)` — добавить поле `archived: true, archivedAt: serverTimestamp()`
   - `unarchiveInvoice(id)` — убрать поле `archived`
   - `deleteInvoice(id)` — теперь = `archiveInvoice(id)` (прозрачно)
   - Все `getInvoices()` по умолчанию `where('archived', '==', false)`
   - Новый query param `?includeArchived=true` для показа архива

2. **Frontend** (`InvoicesPage.tsx`, `InvoiceRow.tsx`):
   - Кнопка "Архив" вместо "Удалить" 
   - Badge **📦 Архив** для archived инвойсов (opacity: 0.5)
   - Чекбокс "Показать архив" — добавляет `includeArchived=true` в URL
   - Счетчик "Все: 25 (+3 архив)" в заголовке
   - Контекстное меню: "Восстановить из архива"

3. **UI/UX**:
   - Архивные инвойсы: `opacity: 0.5`, курсив даты
   - Фильтр PDF экспорта: "Только активные" / "Включая архив"
   - Search работает только по активным (добавить toggle)

## Верификация
- Создать инвойс → "Архив" → исчез из списка, появился в "Архив"
- `?includeArchived=true` → показывает все
- `npm run build` — без TS ошибок
- PDF экспорт: отдельно активные/все
- Backward compatibility: старые инвойсы без `archived` = активные

DEPLOY_STATUS: OK
