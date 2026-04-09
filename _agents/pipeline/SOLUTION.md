# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: resizable columns в InvoiceTable — завершено

## Выполнено

**feat(table): resizable columns с сохранением в localStorage**

Незавершённая реализация в `src/components/InvoiceTable.tsx` — логика resize была добавлена в state, но JSX не был обновлён. Завершил:

- `<table ref={tableRef}>` + `style={{ tableLayout: 'fixed' }}`
- `<colgroup>` с динамическими `colWidths` процентами  
- `<div className="col-resize-handle">` на каждом `<th>` кроме последнего
- CSS: `.col-resize-handle` позиционирован абсолютно, ширина 6px, синий при hover
- Минимальная ширина колонки 4%, сохранение в `localStorage`

- node --check: ✅ OK
- npm run build: ✅ OK (2.17s, 0 ошибок)
- commit: 16b5a03

DEPLOY_STATUS: OK
