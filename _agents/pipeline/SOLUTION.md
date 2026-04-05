# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Автоматическая дедупликация банковских транзакций — чтобы дубликаты из повторно присланных выписок не засоряли коллекцию bank_transactions

## ARCHITECTURE

### Анализ задачи

**Проблема**: выписки из банка могут приходить повторно (одно и то же письмо дважды, один CSV загружен backfill'ом и через IMAP, и т.п.). Сейчас нет защиты от дубликатов в коллекции `bank_transactions` — это приводит к:
1. Засорению базы (например, уже найден дубль NUIA 19733 — 2 записи на одну оплату)
2. Риску двойного списания при partial payment логике (если фикс применится дважды)
3. Неточной статистике по суммам

**Реальный пример**: инвойс NUIA 19733 имел 2 банковские транзакции по 5614.53 EUR на одну дату с одним референсом — явный дубль.

### Текущее состояние (call sites для `bank_transactions.add()`)

| Файл | Строка | Источник | Dedup? |
|------|--------|----------|--------|
| `automation/accountant_agent.cjs` | 146 | BANK_STATEMENT interceptor | ❌ Нет |
| `automation/imap_daemon.cjs` | 782 | `reconcilePayment()` | ❌ Нет |
| `automation/backfill_bank_transactions.cjs` | 151 | CSV backfill (CLI) | ⚠️ In-memory Set (только в пределах одного запуска, не против Firestore) |

### Варианты решения

**Вариант А**: Composite document ID из хеша ключевых полей
- `txId = hash(companyId|date|amount|reference|counterparty)`
- Использовать `.doc(txId).set(data, { merge: false })` вместо `.add()`
- Firestore сам отвергнет дубликат (idempotent upsert)
- **Плюсы**: атомарно, race-safe, не требует read-before-write
- **Минусы**: существующие документы останутся (нужен cleanup отдельно), меняется документная схема (ID перестанет быть auto-generated)

**Вариант Б**: Read-before-write с query
- Перед `.add()` делать `.where().get()` по ключевым полям
- Если найден — skip
- **Плюсы**: не меняет ID документов
- **Минусы**: не атомарно (race condition при параллельных записях), +1 Firestore read на каждую запись

**Вариант В**: Гибрид — deterministic document ID через `.doc(id).create()`
- Как вариант А, но с `.create()` (throws если документ уже существует) вместо `.set()`
- Ловим ошибку `ALREADY_EXISTS` как успешный skip
- **Плюсы**: атомарно, явная семантика "создай если нет", минимум I/O
- **Минусы**: те же что и А (существующие записи остаются с auto-IDs)

### Выбранное решение: **Вариант В**

Причины:
1. Атомарность (нет race condition между двумя email'ами, приходящими одновременно)
2. Минимум Firestore reads (только 1 write attempt, либо успех, либо ALREADY_EXISTS)
3. Явная семантика — код читается как "сохрани если новый"
4. Не нужна логика кеширования или локального состояния

**Cleanup существующих дубликатов**: отдельным node-скриптом один раз после деплоя — групповать по ключу, оставлять самый старый (по `savedAt`), удалять остальные.

### План реализации

1. **Создать helper `core/bank_dedup.cjs`**:
   - Функция `buildTxKey({ companyId, date, amount, reference, counterparty })` — нормализация + SHA-1 hash → 20 символов
   - Функция `saveBankTransaction(db, txData)`:
     - Строит deterministic ID через `buildTxKey`
     - Вызывает `db.collection('bank_transactions').doc(txId).create(txData)`
     - Ловит `code === 6` (ALREADY_EXISTS) → возвращает `{ duplicate: true, id: txId }`
     - Иначе — `{ duplicate: false, id: txId }`
     - Логирует результат

2. **Обновить call sites**:
   - `accountant_agent.cjs:146` → `await saveBankTransaction(db, {...})`
   - `imap_daemon.cjs:782` → `await saveBankTransaction(db, {...})`
   - `backfill_bank_transactions.cjs:151` → заменить in-memory Set на `saveBankTransaction` (Firestore-based dedup)

3. **Cleanup скрипт `automation/cleanup_bank_tx_duplicates.cjs`** (одноразовый):
   - Загрузить все транзакции по всем компаниям
   - Сгруппировать по ключу `buildTxKey()`
   - В каждой группе с >1 записями — оставить самую старую (`savedAt`), удалить остальные
   - Dry-run по умолчанию, `--fix` для реального удаления
   - Логировать удаляемые ID для аудита

4. **Тест**:
   - `node --check` для всех изменённых файлов
   - Запустить cleanup в dry-run на реальной базе — посмотреть сколько дублей найдёт
   - Если результат разумный — применить `--fix`

### Учтённые протоколы Charter

- **Idempotency**: deterministic ID = идемпотентная запись, повторный вызов безопасен
- **Anti-hallucination**: helper не угадывает данные, только хеширует то что передано
- **PM2 restart**: после изменений в `automation/` Railway auto-deploy перезапустит процессы
- **No silent failures**: дубликаты логируются как `skip`, не как ошибки

### Риски

1. **Изменение schema документов** — ID становится deterministic hash вместо auto-generated. Старые документы останутся с auto-IDs. Решение: cleanup скрипт, который удаляет дубли по ключу, оставляя любого одного представителя
2. **Коллизии хешей** — SHA-1 на 5 полях практически невозможны (probability 2^-160), но теоретически возможны. Смягчение: использовать полный hex digest (40 символов) как ID, не сокращать
3. **Хрупкость ключа** — если одно из полей пустое (null reference), разные транзакции могут иметь одинаковый ключ. Решение: для null/empty полей использовать строку `__empty__`, чтобы избежать collision между "no ref" и "empty ref"
4. **Отличие в формате `date`** — если где-то `date` приходит как "2026-03-26", а где-то как "26.03.2026" → разные хеши. Решение: нормализация даты в helper'е (привести к ISO YYYY-MM-DD)
5. **Cleanup удалит записи с matchedInvoiceId != null** — если у одного дубля есть matched link, а у другого нет, оставить тот что с matched. Решение: при выборе "какой оставить" — приоритет у записи с непустым matchedInvoiceId

### Что НЕ меняем

- Формат схемы документа (поля остаются те же)
- Существующие вызовы Repairman / reconcilePayment
- Логику сопоставления транзакций с инвойсами
- Уже применённые частичные оплаты (в `invoice.payments`)
