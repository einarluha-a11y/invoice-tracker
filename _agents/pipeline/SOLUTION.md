# SOLUTION

PHASE: WAITING
ROUND: 1
TASK: TASK-23 — Кнопка "Tühista" в диалоге архивации плохо видна

## ПРОБЛЕМА

В диалоге "Arhiveeri Arve" кнопка "Tühista" (Отмена) серая на тёмном фоне — почти не видна.
Класс `btn-secondary` нигде не определён в CSS — кнопка получала нулевые стили.

## ИСПРАВЛЕНИЕ

Файл: `src/App.tsx`, строка 486.

```tsx
// Было:
<button ... style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500 }}>

// Стало:
<button ... style={{ borderRadius: '50px', padding: '0.75rem 1.5rem', fontWeight: 500, color: '#fff', border: '1px solid #6b7280', background: 'transparent' }}>
```

- `color: '#fff'` — белый текст
- `border: '1px solid #6b7280'` — чёткая серая рамка (gray-500)
- `background: 'transparent'` — без фона

## Верификация
- npm run build — ✓ built in 2.22s, без ошибок
- Кнопка "Tühista" белая с чёткой рамкой, хорошо видна на тёмном фоне

DEPLOY_STATUS: OK
