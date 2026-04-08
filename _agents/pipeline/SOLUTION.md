# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-23 — Кнопка "Tühista" в диалоге архивации плохо видна

## ПРОБЛЕМА

В диалоге "Arhiveeri Arve" кнопка "Tühista" (Отмена) серая на тёмном фоне — почти не видна.
Кнопка "Arhiiви" видна хорошо (белый текст).

## ИСПРАВЛЕНИЕ

Найди компонент диалога архивации (скорее всего ConfirmDialog.tsx или InvoiceTable.tsx).
Кнопке "Tühista" добавить явный стиль:

```tsx
// Было (невидимая):
<button onClick={onCancel} className="text-gray-400">
  Tühista
</button>

// Стало (видимая):
<button 
  onClick={onCancel} 
  className="text-white border border-gray-500 rounded-full px-6 py-2 hover:bg-gray-700"
>
  Tühista
</button>
```

Или если используется существующий компонент — добавить вариант `variant="secondary"` с белым текстом и рамкой.

## Верификация
- Открыть диалог архивации
- Кнопка "Tühista" чётко видна на тёмном фоне
- npm run build без ошибок

