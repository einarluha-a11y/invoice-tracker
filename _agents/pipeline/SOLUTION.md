# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мягкое удаление инвойсов (архив вместо delete)

## ЗАДАНИЕ

1. **Backend изменения** (`src/lib/invoices.ts`):
   - Добавить поле `archived: boolean = false` ко всем инвойсам (миграция)
   - Вместо `deleteDoc(invoiceRef)` → `updateDoc(invoiceRef, {archived: true, deletedAt: serverTimestamp()})`
   - API endpoint `/invoices` → фильтр `where('archived', '==', false)` по умолчанию
   - Новый endpoint `POST /invoices/:id/archive` для мягкого удаления

2. **Frontend изменения** (`src/components/InvoiceList.tsx`, `InvoiceRow.tsx`):
   - Кнопка "Архив" вместо "Удалить" 
   - В списке показывать только `!archived`
   - Добавить вкладку "Архив" с фильтром `archived == true`
   - Подтверждение: "Переместить в архив?"

3. **Firestore миграция** (один раз):
