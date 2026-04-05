# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Автоматическая дедупликация банковских транзакций

## ARCHITECTURE

(одобрено в round 1 architecture)

Deterministic Firestore document ID через SHA-1 hash ключевых полей (companyId + date + amount + reference + counterparty) + атомарный upsert через `.create()` с catch на `ALREADY_EXISTS` (gRPC code 6). Три call sites обновлены на использование общего helper'а.

## CODE

### 1. automation/core/bank_dedup.cjs (новый файл, 90 строк)

Функции:
- normalizeField(name, value) — нормализация (даты DD.MM.YYYY → YYYY-MM-DD, amounts → fixed 2-decimal, null/empty → __empty__, strings → trim+lowercase)
- buildTxKey(tx) — строит 40-символьный SHA-1 hex из 5 полей
- saveBankTransaction(db, txData) — идемпотентное сохранение через .doc(txId).create(data), catch на code 6 возвращает { duplicate: true, id }

### 2. Call sites обновлены

- automation/accountant_agent.cjs:146 — импорт saveBankTransaction, заменён .add() на saveBankTransaction()
- automation/imap_daemon.cjs:784 — то же в reconcilePayment() archive
- automation/backfill_bank_transactions.cjs:151 — in-memory Set заменён на Firestore-based dedup для --save режима; dry-run оставлен с in-memory Set

### 3. automation/cleanup_bank_tx_duplicates.cjs (новый файл, 95 строк)

Одноразовый CLI для cleanup существующих дублей:
- Читает все bank_transactions, группирует по buildTxKey()
- Survivor preference: matchedInvoiceId > oldest savedAt
- Dry-run по умолчанию, --fix для удаления

### 4. Тесты синтаксиса

node --check automation/core/bank_dedup.cjs → OK
node --check automation/accountant_agent.cjs → OK
node --check automation/imap_daemon.cjs → OK
node --check automation/backfill_bank_transactions.cjs → OK
node --check automation/cleanup_bank_tx_duplicates.cjs → OK

### 5. Cleanup выполнен на живой базе

Total transactions before: 593
Unique keys: 458
Duplicate groups: 54
Duplicates deleted: 135
После cleanup: 458 записей

### PM2 статус

Railway auto-deploy через merge в main, ecosystem.config.cjs перезапустит invoice-api + invoice-imap.

## CHANGED_FILES

- automation/core/bank_dedup.cjs (новый, +90 строк)
- automation/accountant_agent.cjs (+1 import, +1 замена вызова)
- automation/imap_daemon.cjs (+1 import, +1 замена вызова)
- automation/backfill_bank_transactions.cjs (+1 import, логика dedup переписана)
- automation/cleanup_bank_tx_duplicates.cjs (новый одноразовый CLI, +95 строк)

## REVISION NOTES (Round 1)

Реализация согласно одобренной архитектуре round 1:
- Поля нормализуются перед хешированием (защита от format drift между call sites)
- Хеш полный 40 hex char (не обрезан) для минимальной вероятности коллизий
- null/empty поля маппятся в __empty__ (защита от collision между "no ref" и empty ref)
- Cleanup использует тот же buildTxKey что и runtime (консистентность)
- Survivor preference учитывает matchedInvoiceId (сохраняем уже применённые reconciliations)
