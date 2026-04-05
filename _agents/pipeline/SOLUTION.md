# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Разбить imap_daemon.cjs (1572 строки) на тематические модули

## ARCHITECTURE

### Текущее состояние

`automation/imap_daemon.cjs` — 1572 строки, 14 функций, 9 тематических блоков:

| Блок | Строки | Функции |
|------|--------|---------|
| Vendor aliases cache | 24-73 | `getVendorAliases` |
| Storage upload | 74-100 | `uploadToStorage` |
| Legacy AI parse (Haiku) | 101-108 | `parseInvoiceDataWithAI` |
| Firestore writer + dedup | 109-461 | `writeToFirestore` |
| Scout→Teacher pipeline | 462-526 | `scoutTeacherPipeline` |
| Reconciliation engine | 527-831 | `reconcilePayment` (300+ строк) |
| Bank statement CSV | 832-896 | `processBankStatement` |
| Bank AI parser | 897-959 | `parseBankStatementWithAI` |
| IMAP email processor | 960-1393 | `checkEmailForInvoices` (430+ строк) |
| Poll orchestrator | 1394-1430 | `pollAllCompanyInboxes` |
| Flag task runner | 1431-1488 | `checkAndRunFlagTasks` |
| Boot + loops | 1490-1570 | `pollLoop`, `auditLoop`, `sweepStatuses` |

### Внешние зависимости от файла

- `automation/firestore_writer.cjs` — импортирует `writeToFirestore`
- Нигде больше imap_daemon не импортируется (grep чистый)
- Запускается как PM2 процесс (`ecosystem.config.cjs` → `invoice-imap`)

### Целевая архитектура

Разбиваем на **6 модулей + тонкая точка входа**:

```
automation/
├── imap_daemon.cjs          (точка входа, ~60 строк: require + pollLoop + auditLoop)
├── core/
│   ├── firebase.cjs         (уже существует)
│   ├── bank_dedup.cjs       (уже существует)
│   ├── reconcile_rules.cjs  (уже существует)
│   ├── utils.cjs            (уже существует)
│   ├── staging.cjs          (уже существует)
│   ├── vendor_aliases.cjs   ← NEW: getVendorAliases + кэш
│   └── storage.cjs          ← NEW: uploadToStorage
├── pipeline/
│   ├── invoice_processor.cjs    ← NEW: scoutTeacherPipeline + writeToFirestore
│   └── payment_processor.cjs    ← NEW: reconcilePayment + processBankStatement
│                                (имя под будущую Dropbox интеграцию — один модуль
│                                 на "любые source → reconciliation")
├── daemon/
│   ├── imap_listener.cjs        ← NEW: checkEmailForInvoices + pollAllCompanyInboxes
│   ├── status_sweeper.cjs       ← NEW: sweepStatuses + auditLoop
│   └── flag_runner.cjs          ← NEW: checkAndRunFlagTasks
```

### Почему такая группировка

1. **`core/vendor_aliases.cjs`** — shared utility с TTL кэшем. Используется в `reconcilePayment` (через payment_processor). Малый (~50 строк), отдельно потому что кэш должен быть singleton.

2. **`core/storage.cjs`** — тонкая обёртка над Firebase Storage upload. Используется в checkEmailForInvoices при приёме attachments. Отдельно чтобы в будущем Dropbox processor мог её переиспользовать.

3. **`pipeline/invoice_processor.cjs`** — `scoutTeacherPipeline` + `writeToFirestore` + все dedup checks. Это "путь инвойса" — от extraction до Firestore. Используется:
   - imap_listener (после парсинга PDF attachment)
   - repairman_agent (re-extract)
   - dropbox_processor в будущем

4. **`pipeline/payment_processor.cjs`** — `reconcilePayment` + `processBankStatement` + `parseBankStatementWithAI`. Это "путь платежа" — от CSV/bank statement до matching с инвойсами. По твоему замечанию, модуль называется `payment_processor` (не `bank_statement_processor`) — он охватит и будущий Dropbox source.

5. **`daemon/imap_listener.cjs`** — только IMAP часть: connection, fetch, attachment extraction, вызов invoice_processor или payment_processor по типу вложения. Чистая "доставка" без бизнес-логики.

6. **`daemon/status_sweeper.cjs`** — `sweepStatuses` + `auditLoop` (bidirectional self-healing). Периодический фоновый процесс.

7. **`daemon/flag_runner.cjs`** — `checkAndRunFlagTasks` (флаговые триггеры от Claude/Cowork).

8. **`automation/imap_daemon.cjs`** — превращается в тонкую точку входа (~60 строк):
   ```js
   require('dotenv').config({ path: __dirname + '/.env' });
   const { pollLoop } = require('./daemon/imap_listener.cjs');
   const { auditLoop } = require('./daemon/status_sweeper.cjs');
   const { checkAndRunFlagTasks } = require('./daemon/flag_runner.cjs');

   if (require.main === module) {
       checkAndRunFlagTasks().then(() => {
           pollLoop();
           auditLoop();
       });
   }
   ```

### Обратная совместимость

1. **`firestore_writer.cjs`** — обновить источник re-export:
   ```js
   const { writeToFirestore } = require('./pipeline/invoice_processor.cjs');
   module.exports = { writeToFirestore };
   ```
   Все внешние consumers продолжают работать без изменений.

2. **`ecosystem.config.cjs`** — `script: './automation/imap_daemon.cjs'` остаётся как есть.

3. **`imap_daemon.cjs` module.exports** — старый экспорт
   ```js
   { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes }
   ```
   заменяется на re-exports из новых модулей (на случай если кто-то импортирует напрямую — grep сейчас показывает только firestore_writer, но подстраховка нужна).

### План реализации (CODE phase)

**Порядок — от листьев к корню (минимизирует одновременно ломающиеся файлы):**

1. **`core/vendor_aliases.cjs`** — вынести `getVendorAliases` + кэш (self-contained)
2. **`core/storage.cjs`** — вынести `uploadToStorage`
3. **`pipeline/invoice_processor.cjs`** — `scoutTeacherPipeline` + `writeToFirestore` (зависит от storage, reconcile_rules, bank_dedup)
4. **`pipeline/payment_processor.cjs`** — `reconcilePayment` + `processBankStatement` + `parseBankStatementWithAI` (зависит от vendor_aliases, reconcile_rules, bank_dedup)
5. **`daemon/imap_listener.cjs`** — `checkEmailForInvoices` + `pollAllCompanyInboxes` (зависит от invoice_processor, payment_processor, storage)
6. **`daemon/status_sweeper.cjs`** — `sweepStatuses` + `auditLoop`
7. **`daemon/flag_runner.cjs`** — `checkAndRunFlagTasks`
8. **`imap_daemon.cjs`** — сократить до thin entry point
9. **`firestore_writer.cjs`** — обновить source of writeToFirestore

### Верификация

- `node --check` всех новых + изменённых файлов
- `node automation/tests/reconcile.test.cjs` (23 теста — regression)
- `node automation/tests/cleannum.test.cjs` (21 тест — regression)
- `npm run build` — frontend unaffected
- **Smoke test:** `node -e "require('./automation/firestore_writer.cjs').writeToFirestore"` должен вернуть function (verify re-export chain)
- **Smoke test 2:** `node -e "require('./automation/imap_daemon.cjs')"` без `require.main === module` не должен стартовать pollLoop (проверяем что импорт безопасен)

### Риски

1. **Круговые зависимости** — risk: invoice_processor может понадобиться checkBankTransactions из payment_processor (или наоборот). Mitigation: reconcile_rules уже вынесен в core, проверить граф через grep перед коммитом.

2. **Инициализация Firebase/Storage** — каждый новый модуль требует `const { admin, db, bucket } = require('../core/firebase.cjs')`. core/firebase singleton уже обеспечивает, что повторный require безопасен.

3. **Shared state кэша vendorAliases** — если модуль кэша require'ится из двух мест, кэш должен быть один. Node.js module cache гарантирует singleton для require того же файла — safe.

4. **Ghost imports** — какой-то скрипт в automation/ может импортировать `checkEmailForInvoices` или `reconcilePayment` напрямую из imap_daemon.cjs. Проверил grep — только firestore_writer импортирует writeToFirestore. Но добавим re-exports в thin imap_daemon.cjs на всякий случай.

5. **Regression в reconcilePayment** — функция критична (мы её только что ужесточали). Код переносим 1-в-1, без семантических изменений. Тесты reconcile.test.cjs ловят основные кейсы.

6. **Размер диффа** — будет большой (1572 строки перемещаются). Review потребует времени, но каждый модуль читается изолированно.

### Что НЕ меняем

- Семантику `reconcilePayment`, `writeToFirestore`, `scoutTeacherPipeline` (только перемещение)
- Ecosystem.config.cjs (имена PM2 процессов)
- Firestore schema
- Тесты (reconcile.test.cjs и cleannum.test.cjs остаются как есть)
- Внешний API `firestore_writer.cjs` (остаётся единственная точка для внешних consumers)
