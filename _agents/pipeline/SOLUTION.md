# SOLUTION

PHASE: ACTIVE
ROUND: 1
TASK: TASK-24 — CSV экспорт инвойсов

## Что сделано
- `src/App.tsx` — добавлена функция `handleExportCsv()` и кнопка "⬇ CSV" в filters-bar
- Экспортирует текущий отфильтрованный вид (учитывает searchTerm, statusFilter, startDate, endDate, dateFilterType, showArchived)
- RFC 4180 экранирование кавычек/запятых
- BOM (\uFEFF) для корректного открытия в Excel
- Имя файла: `invoices_YYYY-MM-DD.csv`
- `npm run build` — ✅ без ошибок

## Аудит изменённых файлов
- `src/App.tsx`: только добавлены `handleExportCsv` + кнопка. Никаких side effects.
- `_agents/pipeline/BACKLOG.md`: добавлен TASK-24

DEPLOY_STATUS: OK
