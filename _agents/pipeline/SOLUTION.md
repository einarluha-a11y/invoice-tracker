# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мягкое удаление инвойсов (архив вместо delete)

## ЗАДАНИЕ

1. **Бэкенд изменения** (`src/lib/invoice.ts` и endpoints):
   - Добавить поле `isArchived: boolean` в тип `Invoice` (по умолчанию `false`)
   - Функция `archiveInvoice(invoiceId: string)`: `updateDoc(invoicesRef.doc(invoiceId), { isArchived: true, archivedAt: serverTimestamp() })`
   - Функция `unarchiveInvoice(invoiceId: string)`: `updateDoc(invoicesRef.doc(invoiceId), { isArchived: false, archivedAt: null })`
   - Endpoint `POST /api/invoices/:id/archive` → вызывает `archiveInvoice(id)`
   - Endpoint `POST /api/invoices/:id/unarchive` → вызывает `unarchiveInvoice(id)`
   - Все `DELETE /api/invoices/:id` заменить на `archiveInvoice(id)` (return 200 с сообщением "Инвойс архивирован")

2. **Frontend** (`src/components/InvoiceTable.tsx` и `useInvoices.ts`):
   - Фильтр `showArchived: boolean` в состоянии таблицы (чекбокс "Показать архивированные")
   - В `filteredInvoices`: `invoices.filter(i => !i.isArchived || showArchived)`
   - Кнопка "Архивировать" вместо "Удалить" в строке инвойса
   - `handleArchive(id)` → `fetch('/api/invoices/${id}/archive', {method: 'POST'})` → refetch invoices
   - Иконка архива (📦) для архивированных инвойсов в колонке Status

3. **UI/UX улучшения**:
   - Архивированные инвойсы: полупрозрачные (opacity: 0.6), Status = "📦 Архив"
   - В шапке таблицы: счетчик "Активных: X | Архивированных: Y"
   - PDF экспорт: **только активные** инвойсы (исключить `isArchived: true`)

## Верификация
- Firestore: поле `isArchived` в типе `Invoice`, `archivedAt` timestamp
- API: `POST /invoices/ABC/archive` → инвойс `isArchived: true`
- Frontend: чекбокс "Показать архивированные" фильтрует таблицу
- Кнопка "Архивировать" → инвойс становится полупрозрачным 📦 Архив
- PDF экспорт: архивированные **НЕ** попадают в PDF
- Build: ✓ `npm run build`
- Deploy: Railway auto-deploy → DEPLOY_STATUS: OK
