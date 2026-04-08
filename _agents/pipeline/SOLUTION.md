# SOLUTION

PHASE: WAITING
ROUND: 1
TASK: TASK-24 — COMPLETED

## ВЫПОЛНЕНО

**CSV экспорт инвойсов** — реализован в `src/App.tsx`.

### Что сделано:
- Функция `handleExportCsv` (строки 184–232) — RFC 4180 escape, BOM для Excel
- Кнопка "⬇ CSV" в `filters-bar` рядом с фильтрами (строки 450–465)
- Экспортируются только отфильтрованные инвойсы (учитывает searchTerm, statusFilter, dateRange, showArchived)
- Поля: Vendor, Invoice No, Date Created, Due Date, Amount, Currency, Status
- Имя файла: `invoices_YYYY-MM-DD.csv`
- Без внешних зависимостей (browser Blob API)
- `npm run build` — ✓ без ошибок

DEPLOY_STATUS: OK
