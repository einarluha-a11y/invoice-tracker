# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: PDF экспорт списка инвойсов для бухгалтера

## ЗАДАНИЕ

1. **`src/lib/pdfExport.ts`** — отдельная библиотека для генерации PDF:
   - Функция `generateInvoicesPDF(invoices: Invoice[], options: PdfExportOptions)`
   - Шапка: название компании, период (from–to), всего инвойсов + суммы по валютам
   - Таблица: №, Invoice No, Date, Due Date, Amount, Currency, Status, Vendor
   - Локализация через `locale` параметр

2. **`src/components/InvoiceTable.tsx`** — рефакторинг `handleExportPDF`:
   - Удалены inlined jsPDF/autoTable импорты из компонента
   - Вызов `generateInvoicesPDF(filteredAndSortedInvoices, { companyName, startDate, endDate, statusFilter, locale })`

## ВЫПОЛНЕНО

- `src/lib/pdfExport.ts` создан с `generateInvoicesPDF` + `PdfExportOptions`
- Шапка PDF: название компании, период дат, итоговое количество + суммы по каждой валюте
- Таблица: 8 колонок (добавлен №, Invoice No, Currency как отдельный столбец)
- `InvoiceTable.tsx`: убраны jsPDF/autoTable импорты, `handleExportPDF` стал 12-строчным
- Build: ✓ чистый (`npm run build` без ошибок)
- node --check: OK

DEPLOY_STATUS: OK
