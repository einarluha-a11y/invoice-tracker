# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-24 — ### TASK-24 ⏳ IN PROGRESS
**CSV экспорт инвойсов**

Добавить кнопку "Export CSV" в интерфейс — выгрузка текущего отфильтрованного списка инвойсов.

**Что экспортировать:**
- Все поля текущего отфильтрованного вида: vendorName, invoiceNumber, dateCreated, dueDate, amount, currency, status
- Только видимые (отфильтрованные) инвойсы, а не все
- Имя файла: `invoices_YYYY-MM-DD.csv`

**Где разместить:**
- Кнопка "⬇ CSV" рядом с фильтрами в `src/App.tsx`
- Функция `exportToCsv(invoices)` в `src/data/utils.ts` или прямо в App.tsx

**Требования:**
- Без внешних зависимостей (только browser Blob API)
- Корректная обработка запятых и кавычек в полях (RFC 4180)
- `npm run build` без ошибок TypeScript

## ЗАДАНИЕ

**1. Создать функцию `exportToCsv` в `src/App.tsx` (после строки 180, перед JSX):**
