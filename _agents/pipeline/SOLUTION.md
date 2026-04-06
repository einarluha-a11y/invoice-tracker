# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Два фикса: cleanVendorName + parseFloat→cleanNum

## ARCHITECTURE
(одобрена в ARCHITECTURE round 1)

## CODE

### Что реализовано

**Фикс 1 — cleanVendorName (было выполнено ранее):**
- Добавлена `cleanVendorName()` в `core/utils.cjs` — убирает все виды кавычек
- Применена в `document_ai_service.cjs:259` (после Azure DocAI)
- Применена в `teacher_agent.cjs:108` (после Claude)

**Фикс 2 — parseFloat→cleanNum:**
- `core/utils.cjs:22` — `parseFloat(s)` заменён на `Number(s)` с `isFinite` проверкой
- Заменены все parseFloat для денежных сумм:
  - `accountant_agent.cjs` строки 89, 438, 585
  - `core/bank_dedup.cjs` строка 28 + добавлен импорт cleanNum
  - `document_ai_service.cjs` строка 356
  - `imap_daemon.cjs` строка 798
  - `repairman_agent.cjs` строки 529, 532
  - `teacher_agent.cjs` строки 526, 527, 730
- НЕ тронуты: `teacher_agent.cjs` строки 1262-1268 (parseFloat для UI цвета)

### Тесты синтаксиса
```
✅ accountant_agent.cjs — node --check OK
✅ bank_dedup.cjs — node --check OK
✅ document_ai_service.cjs — node --check OK
✅ imap_daemon.cjs — node --check OK
✅ repairman_agent.cjs — node --check OK
✅ teacher_agent.cjs — node --check OK
✅ core/utils.cjs — node --check OK
```

### Тесты
```
cleannum.test.cjs — 21 passed, 0 failed
reconcile.test.cjs — 23 passed, 0 failed
```

### Изменённые файлы
1. automation/core/utils.cjs — cleanVendorName + Number(s) вместо parseFloat
2. automation/core/bank_dedup.cjs — импорт cleanNum + замена parseFloat
3. automation/accountant_agent.cjs — 3 замены parseFloat→cleanNum
4. automation/document_ai_service.cjs — cleanVendorName + 1 замена parseFloat
5. automation/imap_daemon.cjs — 1 замена parseFloat→cleanNum
6. automation/repairman_agent.cjs — 2 замены parseFloat→cleanNum
7. automation/teacher_agent.cjs — cleanVendorName + 3 замены parseFloat→cleanNum
