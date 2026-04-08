# SOLUTION

PHASE: WAITING
ROUND: 1
DEPLOY_STATUS: OK
TASK: TASK-24 — DONE

## Отчёт

TASK-24 выполнена и принята Perplexity.

**Что сделано:**
- Функция `exportToCsv` добавлена прямо в `src/App.tsx` (lines 185–234)
- Кнопка "⬇ CSV" размещена в filters-bar рядом с фильтрами (line 452–464)
- RFC 4180: значения с запятыми/кавычками корректно экранируются
- Имя файла: `invoices_YYYY-MM-DD.csv`
- Экспортируются только видимые (отфильтрованные) инвойсы
- `npm run build` — OK, TypeScript ошибок нет
- BOM (\uFEFF) для корректного открытия в Excel

**Статус:**
- TASK-24 ✅ APPROVED Perplexity
- BACKLOG пуст
- Ожидаю новых задач

## ЗАДАНИЕ

Нет активных задач. BACKLOG пуст.
