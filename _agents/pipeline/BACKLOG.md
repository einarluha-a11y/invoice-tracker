# BACKLOG — Invoice-Tracker Pipeline

## Правила
- Задания выполняются строго по порядку
- Следующее задание берётся только после DEPLOY_STATUS: OK предыдущего
- Перплексити делает ревью каждого задания перед переходом к следующему

---

## ОЧЕРЕДЬ

### TASK-01 ✅ DONE
Фаза 1 — Фундамент мультипользовательского режима
(master_users, accounts структура, migrate_to_accounts.cjs, Firestore rules)

---

### TASK-02 ✅ DONE
**Фаза 2 — Frontend мультипользовательский режим**

Реализовать три изменения во фронтенде:

**1. Login.tsx** — добавить поле выбора аккаунта перед входом:
- Input или dropdown "Название аккаунта" (autocomplete по `accounts/` коллекции — только поле `name`)
- Для мастера (uid = MI9J2VBriwQ45jEMJ5tmbagfHm93) кнопка "Войти как мастер" без выбора аккаунта
- Сохранять выбранный accountId в state до Google входа

**2. AuthContext.tsx** — логика трёх ролей:
- После signInWithGoogle проверить uid в `master_users/{uid}` → role='master'
- Иначе: проверить `accounts/{selectedAccountId}/users/{uid}` → role из документа
- Если нет → signOut + сообщение "Нет доступа к аккаунту {name}"
- Добавить в контекст: `currentAccountId`, `userRole: 'master'|'admin'|'user'`, `isMaster`
- Мастер после входа видит AccountSelector (список всех accounts/)

**3. useCompanies.ts** — фильтрация по аккаунту:
- Путь: `accounts/{currentAccountId}/companies/` вместо `companies/`
- Для мастера: принимать произвольный accountId как параметр
- CRUD: только master и admin могут добавлять/удалять компании

**Backward compatibility:**
- Старая коллекция `companies/` остаётся нетронутой
- Новый путь читается параллельно
- Если `accounts/{accountId}/companies/` пустой — fallback на старый путь

**Верификация:**
- `npm run build` без ошибок TypeScript
- Войти как einar.luha@gmail.com → должен увидеть AccountSelector
- Выбрать Global Technics → должны загрузиться инвойсы
- Выбрать Ideacom → должны загрузиться инвойсы Ideacom

---

### TASK-03 ✅ DONE
**Фаза 3 — Backend auth middleware**

1. `api_server.cjs` — добавить verifyToken middleware на все /api/* роуты
2. `webhook_server.cjs` — аналогично
3. Frontend `api.ts` — добавить Authorization: Bearer {token} header ко всем fetch запросам
4. Делать одновременно frontend + backend (иначе сломается)

---

### TASK-04 ✅ DONE
**Фаза 4 — Cleanup**

1. Удалить `VITE_ALLOWED_EMAILS` из AuthContext (заменено Firestore-based доступом)
2. Удалить хардкод emails в AuthContext.tsx
3. Убрать старые bootstrap admin правила из firestore.rules
4. Удалить старую коллекцию `companies/` (только после проверки что всё работает)

---

### TASK-05 ✅ DONE
**Кэш правил + хардкод storage bucket**

1. `core/firebase.cjs` — экспортировать `invalidateRulesCache()`
2. `api_server.cjs` — добавить `POST /api/invalidate-cache`
3. Frontend Settings — вызывать invalidate-cache после сохранения
4. `core/firebase.cjs:23` — заменить хардкод bucket на `process.env.FIREBASE_STORAGE_BUCKET`
5. Добавить в `.env` и `.env.production`

---

### TASK-06 ✅ DONE
**Рефакторинг updateInvoice() — разбить 359 строк на функции**

`src/data/api.ts:156-514` — разбить на:
- `saveInvoiceToDb()` — только запись в Firestore
- `saveTeacherExample()` — запись примера для Teacher
- `updateVendorProfile()` — обновление профиля вендора
- `generateGlobalRules()` — генерация правил
- `reconcileWithBankStatement()` — сверка с банком
`updateInvoice()` остаётся как оркестратор который вызывает все пять

---

### TASK-07 ✅ DONE
**Разбивка imap_daemon.cjs на модули**

Согласно утверждённому плану:
- `imap_listener.cjs` — IMAP подключение, poll loop, attachments
- `invoice_processor.cjs` — scoutTeacherPipeline + writeToFirestore
- `bank_statement_processor.cjs` — CSV парсинг + reconcilePayment
- `status_sweeper.cjs` — sweepStatuses + auditLoop
- `imap_daemon.cjs` — точка входа, подключает модули

---

### TASK-08 ✅ DONE
**Dropbox прямая интеграция**

Заменить Zapier на прямой Dropbox API:
- `automation/dropbox_service.cjs` — ✅ создан, OAuth2 refresh token flow
- Автоматическое создание папок по структуре компании — ✅ `buildDropboxFolderPath()`
- Логирование dropboxPath в Firestore — ✅ `invoice_processor.cjs:353`
- Убрать Zapier webhook — ✅ Zapier webhook вызовов не осталось
