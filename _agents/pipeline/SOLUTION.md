# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Убрать кавычки из vendorName — системное правило очистки

## ARCHITECTURE

### Проблема
В дашборде отображаются названия компаний с кавычками двух типов:
- Прямые: UAB "Ursus LT" — должно быть: UAB Ursus LT
- Угловые/стрелки: «Inovatus MB>> — должно быть: Inovatus MB

Кавычки приходят из PDF инвойсов как есть. Нужно системное правило которое убирает их при извлечении — один раз и везде.

### Решение

**Шаг 1:** Добавить `cleanVendorName` в `automation/core/utils.cjs`:

```js
/**
 * Strip all quote characters from vendor names.
 * Handles: "straight", guillemets, arrows, low-high, single quotes
 */
function cleanVendorName(name) {
    if (!name) return name;
    return name
        .replace(/[\u0022\u201C\u201D\u201E\u201F]/g, '')   // двойные кавычки всех видов
        .replace(/[\u0027\u2018\u2019\u201A\u201B]/g, '')   // одиночные кавычки
        .replace(/[\u00AB\u00BB\u2039\u203A]/g, '')          // угловые guillemets
        .replace(/[<>]{1,2}/g, '')                           // стрелки << >>
        .replace(/\s{2,}/g, ' ')                             // двойные пробелы после удаления
        .trim();
}
```

**Шаг 2:** Применить в двух точках входа:

1. `automation/document_ai_service.cjs` — после строки ~259 где `vendorName` извлекается из DocAI:
```js
vendorName = cleanVendorName(vendorName);
```

2. `automation/teacher_agent.cjs` — после строки ~108 где `parsed.vendorName` получен от Claude:
```js
if (parsed.vendorName) parsed.vendorName = cleanVendorName(parsed.vendorName);
```

**Шаг 3:** Экспортировать из utils.cjs — добавить `cleanVendorName` в `module.exports`.

### Что НЕ трогаем
- Уже записанные инвойсы в Firestore (Ремонтник исправит их отдельно если нужно)
- Логику reconcilePayment — cleanVendorName применяется ДО записи в Firestore, не в reconcile

### Верификация
- `node --check automation/core/utils.cjs`
- `node --check automation/document_ai_service.cjs`
- `node --check automation/teacher_agent.cjs`
- `node automation/tests/cleannum.test.cjs` — regression
