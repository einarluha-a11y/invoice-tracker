# SOLUTION

**Оценка выполненной работы:** Claude исправил критическую ошибку "Transaction too big" в invoice-imap, разбив большие транзакции Firestore на батчи. Синтаксис проверен (node --check OK), PM2 стабильны без рестартов. DEPLOY_STATUS: OK добавлен.

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мягкое удаление инвойсов (архив вместо delete)

## ЗАДАНИЕ

1. **Backend изменения:**
   - В коллекции `invoices` добавить поле `deletedAt: timestamp | null` (по умолчанию null)
   - Создать endpoint `DELETE /companies/:companyId/invoices/:invoiceId` → устанавливает `deletedAt: now()` вместо удаления
   - Создать endpoint `POST /companies/:companyId/invoices/:invoiceId/restore` → очищает `deletedAt`
   - Все SELECT-запросы (list, search, dashboard) фильтровать `where('deletedAt', '==', null)`
   - Добавить query-параметр `?includeDeleted=true` для админов (показывать удалённые)

2. **Frontend изменения:**
   - В InvoiceList: кнопка "Архив" вместо "Delete" 
   - В InvoiceDetail: кнопка "Восстановить" если `deletedAt` существует
   - useInvoices() хук: по умолчанию `includeDeleted: false`, опция для админов

3. **Миграция данных:** Написать скрипт `automation/soft_delete_migration.cjs` для конвертации `isDeleted: true` → `deletedAt: now()`

4. **Тестирование:**
   - Создать инвойс → "Архив" → исчез из списка
   - `?includeDeleted=true` → виден в архиве
   - "Восстановить" → вернулся в основной список
   - Deploy на Railway

После выполнения добавить в конец этого файла:
