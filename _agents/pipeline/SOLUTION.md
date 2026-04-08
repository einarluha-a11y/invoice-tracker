# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-23 Round 2 — кнопка Tühista должна выглядеть как кнопка (рамка, hover)

## ПРОБЛЕМА

Кнопка "Tühista" выглядит как просто текст — нет рамки, нет hover эффекта.
Пользователь не понимает что это кликабельный элемент.

## ИСПРАВЛЕНИЕ

Найди кнопку "Tühista" в диалоге архивации и замени стиль:

```tsx
<button
  onClick={onCancel}
  className="px-6 py-2 rounded-full border border-white text-white hover:bg-white hover:text-gray-900 transition-colors font-medium"
>
  Tühista
</button>
```

Кнопка "Arhiiви" для сравнения должна остаться как есть (белый фон, тёмный текст, bold).

Результат: два чётко видимых варианта — одна с белым фоном, другая с белой рамкой.

## Верификация
- Открыть диалог архивации
- "Tühista" — прозрачная с белой рамкой, при hover становится белой
- "Arhiiви" — белая кнопка, жирный текст
- npm run build без ошибок

