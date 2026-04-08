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

В `src/App.tsx` (строка 248) изменено условие показа аккаунт-switcher:

```tsx
// Было:
{isMaster && availableAccounts.length > 0 && (

// Стало:
{isMaster && availableAccounts.length > 1 && (
```

Аккаунт-switcher теперь показывается ТОЛЬКО если у мастера **больше одного аккаунта**. При одном аккаунте — скрыт. Компания-switcher остался без изменений.

## Верификация
- `npm run build` — OK (✓ built in 2.19s)
- В хедере один dropdown для обычного пользователя / мастера с одним аккаунтом
- Переключение компании работает корректно

- node --check: OK
- npm run build: OK
- DEPLOY_STATUS: OK
