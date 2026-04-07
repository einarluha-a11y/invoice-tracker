# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Фаза 2 — Frontend мультипользовательский режим (Login / AuthContext / useCompanies)

## CODE

### Реализованные изменения

**1. `src/context/AuthContext.tsx`**
- Добавлены роли: `userRole: 'master' | 'admin' | 'user' | null`
- `currentAccountId` — хранит выбранный аккаунт
- `isMaster` — флаг мастер-доступа
- `pendingAccountIdRef` — сохраняет accountId до завершения Google OAuth
- `selectAccount(accountId)` — переключение аккаунта для мастера
- `availableAccounts` — список всех аккаунтов (только для мастера)
- Логика: master_users/{uid} → master, иначе accounts/{accountId}/users/{uid} → role
- signOut + ошибка если нет доступа

**2. `src/components/Login.tsx`**
- Datalist autocomplete по `accounts/` (только поле name)
- Кнопка "Войти как мастер" для uid MI9J2VBriwQ45jEMJ5tmbagfHm93
- accountId сохраняется в state до Google входа

**3. `src/hooks/useCompanies.ts`**
- Путь: `accounts/{currentAccountId}/companies/` вместо `companies/`
- Fallback на `companies/` если новый путь пуст
- `canWrite` — только master и admin

**4. `src/App.tsx`**
- AccountSelector для мастера если `isMaster && !currentAccountId`
- Dropdown аккаунтов в header для мастера
- Settings скрыт для role='user'

### Верификация

```
npm run build → ✅ built in 2.31s, 0 TypeScript errors
```

DEPLOY_STATUS: OK

---

*TASK-02 DONE. Следующий: TASK-03 — Backend auth middleware*
