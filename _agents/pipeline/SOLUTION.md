# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: TASK-23 Round 3 — кнопка Tühista: светло-серая надпись + рамка

## ТОЧНЫЙ СТИЛЬ

```tsx
<button
  onClick={onCancel}
  className="px-6 py-2 rounded-full border border-gray-400 text-gray-300 hover:border-gray-200 hover:text-gray-100 transition-colors font-medium"
>
  Tühista
</button>
```

- Текст: светло-серый (text-gray-300)
- Рамка: серая (border-gray-400)
- При hover: чуть светлее
- Форма: rounded-full как у кнопки Arhiiви

## Верификация
- Диалог открыт — "Tühista" серая с рамкой, "Arhiiви" белая и жирная
- npm run build OK

