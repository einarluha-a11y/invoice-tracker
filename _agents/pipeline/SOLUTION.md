# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Два фикса + настройка тихого мониторинга

## ЗАДАНИЕ 0 — СДЕЛАЙ ПЕРВЫМ: Тихий мониторинг REVIEW.md

Настрой recurring задачу каждые 30 секунд. Она должна работать ТИХО — никаких сообщений если нет изменений.

Логика:
1. git fetch origin --quiet 2>/dev/null
2. Прочитать содержимое `_agents/pipeline/REVIEW.md` из origin/main
3. Извлечь строку `<!-- phase: X | round: Y -->` из файла
4. Сравнить с состоянием в `/tmp/.pipeline_state` (формат: `PHASE:ROUND:VERDICT`)
5. Если не изменилось → полная тишина, ничего не делать
6. Если изменилось → прочитать ВЕРДИКТ:
   - APPROVED → перейти к следующей фазе по протоколу (`_agents/workflows/pipeline_protocol.md`)
   - CHANGES_NEEDED или CODE_CHANGES_NEEDED → прочитать ЗАМЕЧАНИЯ, исправить, обновить SOLUTION.md (ROUND+1), запушить

Инициализация `/tmp/.pipeline_state` при первом запуске:
- Если файла нет — записать текущее состояние из REVIEW.md (не реагировать на уже прочитанные ревью)

Сообщения в окно ТОЛЬКО для:
- `📋 Новый ревью: [phase] round [N] — [ВЕРДИКТ]`
- `🔨 Реализую: [описание]`
- `✅ Готово: [что сделано]`
- `❌ Ошибка: [что случилось]`

После настройки мониторинга — сразу выполни задания 1 и 2 ниже.

---

## ЗАДАНИЕ 1 — cleanVendorName (убрать кавычки из названий компаний)

Добавить в `automation/core/utils.cjs`:

```js
function cleanVendorName(name) {
    if (!name) return name;
    return name
        .replace(/[\u0022\u201C\u201D\u201E\u201F]/g, '')
        .replace(/[\u0027\u2018\u2019\u201A\u201B]/g, '')
        .replace(/[\u00AB\u00BB\u2039\u203A]/g, '')
        .replace(/[<>]{1,2}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
```

Добавить `cleanVendorName` в `module.exports`.

Применить:
1. `document_ai_service.cjs` строка ~259 после `let vendorName = str('VendorName') || 'Unknown Vendor';`
   → `vendorName = cleanVendorName(vendorName);`

2. `teacher_agent.cjs` строка ~108 после получения `parsed.vendorName` от Claude
   → `if (parsed.vendorName) parsed.vendorName = cleanVendorName(parsed.vendorName);`

---

## ЗАДАНИЕ 2 — parseFloat → cleanNum (денежные суммы)

В `automation/core/utils.cjs` строка 22 заменить:
`return parseFloat(s) || 0;` → `return Number(s) || 0;`

Везде ниже где parseFloat используется для денежных сумм — заменить на cleanNum.
Добавить `const { cleanNum } = require('./utils.cjs');` где не импортирован.

Файлы:
- `accountant_agent.cjs` строки 89, 438, 585
- `core/reconcile_rules.cjs` строки 77-78
- `core/bank_dedup.cjs` строка 28
- `document_ai_service.cjs` строка 356
- `imap_daemon.cjs` строка 798
- `repairman_agent.cjs` строки 529, 532
- `teacher_agent.cjs` строки 525, 526, 729

НЕ трогать:
- `teacher_agent.cjs` строки 1261-1267 (parseFloat для % цвета UI)
- `tests/cleannum.test.cjs` (намеренно демонстрирует баг)

---

## Верификация после выполнения заданий 1 и 2
- `node --check` всех изменённых файлов
- `node automation/tests/cleannum.test.cjs`
- `node automation/tests/reconcile.test.cjs`
- `pm2 restart all`
