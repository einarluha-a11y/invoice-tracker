# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Два фикса в одном коммите: (1) cleanVendorName — убрать кавычки, (2) parseFloat → cleanNum везде

## ARCHITECTURE

### Задача 1: cleanVendorName (кавычки в названиях компаний)

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

Добавить в module.exports.

Применить в:
1. `automation/document_ai_service.cjs` строка ~259 после `let vendorName = str('VendorName') || 'Unknown Vendor';`:
   `vendorName = cleanVendorName(vendorName);`

2. `automation/teacher_agent.cjs` строка ~108 после получения `parsed.vendorName` от Claude:
   `if (parsed.vendorName) parsed.vendorName = cleanVendorName(parsed.vendorName);`

---

### Задача 2: parseFloat → cleanNum (26 мест)

Файлы с нарушениями (заменить parseFloat на cleanNum где речь идёт о денежных суммах):

**automation/accountant_agent.cjs** (строки 89, 438, 585):
- `parseFloat((remaining - payAmt).toFixed(2))` → `cleanNum((remaining - payAmt).toFixed(2))`
- `parseFloat((pRemaining - creditAmount).toFixed(2))` → `cleanNum((pRemaining - creditAmount).toFixed(2))`
- `parseFloat((docAiPayload.subtotalAmount + docAiPayload.taxAmount).toFixed(2))` → `cleanNum(...)`

**automation/core/reconcile_rules.cjs** (строки 77-78):
- `parseFloat(invoiceAmount)` → `cleanNum(invoiceAmount)`
- `parseFloat(txAmount)` → `cleanNum(txAmount)`
Добавить `const { cleanNum } = require('./utils.cjs');` в начало файла.

**automation/core/bank_dedup.cjs** (строка 28):
- `parseFloat(value)` → `cleanNum(value)`
Добавить `const { cleanNum } = require('./utils.cjs');`

**automation/document_ai_service.cjs** (строка 356):
- `parseFloat((partial.subtotalAmount + partial.taxAmount).toFixed(2))` → `cleanNum(...)`

**automation/imap_daemon.cjs** (строка 798):
- `parseFloat(newAmount.toFixed(2))` → `cleanNum(newAmount.toFixed(2))`

**automation/repairman_agent.cjs** (строки 529, 532):
- `parseFloat((qcAmount - qcTax).toFixed(2))` → `cleanNum(...)`
- `parseFloat((qcAmount - qcSub).toFixed(2))` → `cleanNum(...)`

**automation/teacher_agent.cjs** (строки 525, 526, 729):
- все три `parseFloat((...).toFixed(2))` → `cleanNum(...)`

ИСКЛЮЧЕНИЯ (не трогать):
- `teacher_agent.cjs` строки 1261-1267: `parseFloat(overallPct)` и `parseFloat(pct)` — это процентные строки для цвета UI, не суммы
- `automation/tests/cleannum.test.cjs` — тестовый файл, намеренно использует parseFloat для демонстрации бага
- `core/utils.cjs` строка 22: финальный `parseFloat(s)` внутри cleanNum — строка уже нормализована, заменить на `Number(s)` для ясности

### Верификация
- `node --check` всех изменённых файлов
- `node automation/tests/cleannum.test.cjs`
- `node automation/tests/reconcile.test.cjs`
- `pm2 restart all`
