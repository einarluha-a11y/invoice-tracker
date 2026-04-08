# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-15 — Убрать дублирующий dropdown компании в хедере

## ПРОБЛЕМА

В хедере два dropdown рядом:
1. "Global Technics" — аккаунт-switcher (новый, добавлен при multitenancy)
2. "Global Technics OÜ" — компания-switcher (старый, работает)

Пользователь видит два похожих поля — лишнее и сбивает с толку.

## РЕШЕНИЕ

В `src/components/Header.tsx` (или где находится хедер):

- Аккаунт-switcher показывать ТОЛЬКО если `isMaster === true` И у мастера больше одного аккаунта
- Для всех остальных пользователей — скрыть аккаунт-switcher
- Компания-switcher оставить как есть — он работает корректно

```tsx
{isMaster && availableAccounts.length > 1 && (
  <AccountSwitcher ... />
)}
<CompanySwitcher ... />
```

## Верификация
- `npm run build` без ошибок
- В хедере виден только один dropdown для текущего пользователя
- Переключение компании работает корректно

