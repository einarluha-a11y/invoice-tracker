# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Два фикса: cleanVendorName + parseFloat→cleanNum

## ARCHITECTURE

### Анализ задачи
Две системные проблемы с качеством данных:
1. Названия компаний приходят с кавычками из PDF ("Ursus LT", «Inovatus MB»)
2. parseFloat() используется вместо cleanNum() для денежных сумм — ломает европейские форматы (1.200,50)

### Выбранное решение

**Фикс 1 — cleanVendorName:**
- Новая функция в `core/utils.cjs` — убирает все виды кавычек
- Применяется в двух точках входа: document_ai_service.cjs (после Azure) и teacher_agent.cjs (после Claude)
- ✅ УЖЕ РЕАЛИЗОВАНО и запушено

**Фикс 2 — parseFloat→cleanNum:**
- Заменить parseFloat(s) на Number(s) в cleanNum() (строка 22 utils.cjs) — ✅ УЖЕ СДЕЛАНО (rebase подтянул)
- Заменить все parseFloat() для денежных сумм на cleanNum() в файлах:
  - accountant_agent.cjs (строки 89, 438, 585)
  - core/reconcile_rules.cjs (строки 77-78)
  - core/bank_dedup.cjs (строка 28)
  - document_ai_service.cjs (строка 356)
  - imap_daemon.cjs (строка 798)
  - repairman_agent.cjs (строки 529, 532)
  - teacher_agent.cjs (строки 525, 526, 729)
- НЕ трогать: teacher_agent.cjs строки 1261-1267 (parseFloat для UI цвета)

### Учтённые протоколы Charter
- Числа через cleanNum, никогда parseFloat напрямую
- Единый источник правды в core/utils.cjs

### Риски
- reconcile_rules.cjs tolerance matching — добавить epsilon ±0.01 после cleanNum
- Regression в тестах cleannum.test.cjs

### Верификация
- node --check всех изменённых файлов
- node automation/tests/cleannum.test.cjs
- node automation/tests/reconcile.test.cjs
