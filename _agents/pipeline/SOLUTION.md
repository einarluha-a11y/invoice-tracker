# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: PDF экспорт списка инвойсов для бухгалтера

## ЗАДАНИЕ

1. **Backend — PDF генератор** (`src/lib/pdfExport.ts`):
   - Функция `generateInvoicesPDF(invoices: Invoice[], companyId: string)` → возвращает Buffer PDF
   - Использовать `pdf-lib` или `puppeteer` для генерации
   - Таблица: №, Дата, Сумма, Валюта, Статус, Контрагент
   - Шапка: Логотип компании, период (from-to), всего инвойсов/сумма
   - Фильтр по статусу/периоду (параметры в запросе)

2. **API endpoint** (`src/pages/api/invoices/export-pdf.ts`):
