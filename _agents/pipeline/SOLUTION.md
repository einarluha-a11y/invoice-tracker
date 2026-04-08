# SOLUTION

PHASE: IMPLEMENTATION
ROUND: 1
TASK: TASK-18 — Вернуть два dropdown в хедер (аккаунт + компания)

## РЕЗУЛЬТАТ

Восстановлен account-switcher в хедере `src/App.tsx`:

1. Добавлены `availableAccounts, selectAccount` в деструктуризацию `useAuth()` в функции App (строка 69)
2. Перед company-select добавлен account-switcher — виден только когда `isMaster && availableAccounts.length > 1`

Теперь в хедере два dropdown рядом:
- Аккаунт (например "Global Technics") — только для master с несколькими аккаунтами
- Компания (например "Global Technics OÜ") — всегда

`npm run build` — успешно, без ошибок.

## DEPLOY_STATUS: OK
