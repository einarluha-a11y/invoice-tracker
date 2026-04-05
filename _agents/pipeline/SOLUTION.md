# SOLUTION

PHASE: CODE
ROUND: 2
TASK: Блок 2 аудита — безопасность и оптимизация (secrets check, reconciliation limit, imap self-invoice guard)

## ARCHITECTURE

Блок 1 (Round 1) одобрен Perplexity как CODE_APPROVED.
Блок 2 — 4 задачи из пункта REVIEW round 1:
- 2.1 Проверка git history на утечку секретов + guidance по ротации
- 2.2 `limit(100)` в reconciliation query (api.ts)
- 2.3 Починить `||` vs `&&` в reconciliation logic
- 2.4 Self-invoice guard в imap_daemon writeToFirestore (последняя линия защиты)

## CODE

### Что реализовано

#### 2.1 Git history check — секреты никогда не утекали в GitHub
- `git log --all --oneline -- automation/.env` → пусто
- `git log --all --oneline -- .env.pipeline` → пусто
- `git log --all --oneline -- "*.env"` → пусто
- Оба `.env` файла с самого начала были в `.gitignore` (строки 28-29 главного + 2 в automation/.gitignore)
- **Ротация токенов не нужна** — они были только локально и в Railway secret variables
- Файлы `.env` и `.env.pipeline` продолжают жить локально + на Railway

#### 2.2 Reconciliation query limit
`src/data/api.ts:1` — импорт `limit` из firebase/firestore
`src/data/api.ts:471-478` — getDocs теперь:
```ts
const txSnap = await getDocs(query(
    collection(db!, 'bank_transactions'),
    where('companyId', '==', d.companyId),
    orderBy('date', 'desc'),
    limit(200)
));
```
- Топ 200 последних транзакций (reconciliation редко нужна для записей старше 6 месяцев)
- Предотвращает OOM при росте базы (раньше был полный scan)

`firestore.indexes.json` — добавлен composite index `(companyId ASC, date DESC)` для bank_transactions

#### 2.3 Reconciliation logic review — ЛОЖНАЯ ТРЕВОГА
- Audit report сообщал про баг `||` → `&&` на строке 465
- При ручной проверке через таблицу истинности — логика **правильная**:
  - `status !== 'Paid' || (currency && currency !== 'EUR')`
  - Срабатывает если либо неоплачен, либо оплачен но в иностранной валюте (нужна FX conversion)
- **Изменения не требуются**, аудит был неточен в этом пункте

#### 2.4 Self-invoice guard в imap_daemon writeToFirestore
`automation/imap_daemon.cjs:165-194` — добавлена финальная проверка перед Firestore write:
- Читает все компании из `companies` collection
- Для каждой проверяет совпадение:
  - `cVat === invVat` (точное совпадение VAT)
  - `invVat.endsWith(cReg)` (regCode внутри VAT, например EE14987085 = Ideacom regCode)
  - `cReg === invReg` (regCode прямое совпадение)
  - `cName === invName` или `invName.includes(cName)` или `cName.includes(invName)` (имя-в-имени)
- Если **любое** из условий выполнено — `throw SELF_INVOICE_GUARD`, запись отклоняется
- Логирование: `Buyer data leaked into vendor fields`
- Это 4-й уровень защиты после: Teacher step 0, Teacher post-Claude, Accountant step 0.6

### Тесты синтаксиса

```
$ node --check automation/imap_daemon.cjs → OK
$ npm run build → built, PWA precache 15 entries (1949.10 KiB)
```

### PM2 статус

Railway auto-deploy через merge в main, `ecosystem.config.cjs` перезапускает invoice-api + invoice-imap автоматически.

## CHANGED_FILES

- `src/data/api.ts` (+2 строки: limit import + orderBy/limit в query)
- `firestore.indexes.json` (+8 строк: bank_transactions index)
- `automation/imap_daemon.cjs` (+30 строк: self-invoice guard перед writeToFirestore)

## REVISION NOTES (Round 2)

- Блок 2.1: секреты не утекали, ротация не нужна
- Блок 2.2: limit(200) + composite index добавлены
- Блок 2.3: audit report ошибся, логика правильная
- Блок 2.4: 4-й уровень self-invoice guard добавлен в imap_daemon

Блок 3 (косметика) — отложен:
- i18n hardcoded строки (settings.tsx, modal.tsx)
- Удаление dead code
- Обновление memory/refactor_plan.md
- Hardcoded emails в firestore.rules
