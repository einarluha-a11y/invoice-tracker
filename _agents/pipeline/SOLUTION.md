# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-23 — Кнопка "Tühista" в диалоге архивации плохо видна

## ПРОБЛЕМА

В диалоге "Arhiveeri Arve" кнопка "Tühista" (Отмена) серая на тёмном фоне — почти не видна.
Кнопка "Arhiiви" видна хорошо (белый текст).

## ИСПРАВЛЕНИЕ

Файл: `src/App.tsx`, строка 486.

Класс `btn-secondary` нигде не определён в CSS — кнопка получала нулевые стили.
Добавлен явный `color: '#fff'` и `border: '1px solid rgba(255,255,255,0.4)'` в inline style.

```tsx
// Было:
<button onClick={() => setDeletingInvoiceId(null)} className="btn-secondary" style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500 }}>

// Стало:
<button onClick={() => setDeletingInvoiceId(null)} className="btn-secondary" style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500, color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}>
```

## Верификация
- npm run build — успешно (✓ built in 2.63s)
- Кнопка "Tühista" теперь белая с рамкой, чётко видна на тёмном фоне

DEPLOY_STATUS: OK
