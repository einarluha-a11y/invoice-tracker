# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Аудит — исправить 6 находок (parseFloat vs cleanNum, дубли функций, dead code, dedup scan, /api/chat, ecosystem hardening)

## ARCHITECTURE

(одобрено round 1 без замечаний)

Единая функция cleanNum, удаление parseAmount alias, замена всех небезопасных parseFloat. Composite индекс (companyId, fileBasename) для O(1) dedup. Haiku restore для /api/chat. PM2 hardening. Удаление 3 dead файлов.

## CODE

### 1. ecosystem.config.cjs — hardening

Добавлены для обоих процессов: `restart_delay: 5000`, `max_restarts: 10`, `exp_backoff_restart_delay: 100`, `max_memory_restart` (500M/1G), `error_file`/`out_file`. Защищает от infinite restart loop.

### 2. Dead code cleanup — `git rm`

Удалены: `automation/supreme_supervisor.cjs`, `automation/overseer_agent.cjs`, `automation/ai_retry.cjs`. Никто не импортирует (проверено grep). Упоминаются только в исторических Charter docs.

### 3. /api/chat — восстановлен через Claude Haiku

`automation/api_server.cjs`: заменён stub 501 на рабочий endpoint, использует `@anthropic-ai/sdk` (уже в deps) + `ANTHROPIC_API_KEY`. Model `claude-haiku-4-5-20251001`, max_tokens 400, rate limit 30/min сохранён. System prompt извлекает filter criteria в JSON. Защита: input.slice(500), try/catch вокруг JSON parse, fallback на 500/503 с human-readable reply.

### 4. Dedup fileBasename — O(1) lookup через composite индекс

`automation/imap_daemon.cjs` writeToFirestore:
- Fast path: `where('companyId', '==', X).where('fileBasename', '==', Y).limit(1)` → составной индекс
- Fallback: для legacy записей без `fileBasename` — ограниченный scan 500 docs
- `fileBasename` сохраняется как denormalized поле при create (lowercase)

`firestore.indexes.json`: добавлен composite индекс `invoices(companyId ASC, fileBasename ASC)`.

### 5. cleanNum refactor — замена parseFloat

**Удалено:**
- `parseAmount = cleanNum` alias в accountant_agent.cjs
- `module.exports.parseAmount` из accountant_agent.cjs
- import `parseAmount` в search_agent.cjs → заменён на `cleanNum` из `core/utils.cjs`

**Заменены небезопасные parseFloat на cleanNum (14 мест в 7 файлах):**
- `automation/imap_daemon.cjs`: numAmount сборка, scoutTeacher sub/tax/amt, reconcile invoiceAmount + originalAmount (2×), CSV bank statement rows (amount, bankFee, explicitTarget, foreignAmountNum)
- `automation/accountant_agent.cjs`: invoiceChargesVat, amtMatches (двойной parseFloat)
- `automation/repairman_agent.cjs`: checkBankTransactions amount, QC amount/sub/tax, audit invoiceAmount + txAmount
- `automation/teacher_agent.cjs`: interactive input parsing
- `automation/backfill_bank_transactions.cjs`: CSV row parsing (amount + sign, bankFee, explicitTarget, foreignAmount)
- `automation/import_csv_bank_transactions.cjs`: same CSV pattern
- `automation/reconcile_bank_statement.cjs`: paidAmount normalization, invoiceAmount read

**Оставлены (безопасные float→float нормализации):**
- `parseFloat((X + Y).toFixed(2))` паттерны в teacher/accountant/document_ai — input уже числовой
- `parseFloat(pct)` для UI score в teacher CLI eval (input — это `.toFixed(1)` string, всегда валидный)

**Обработка знака для bank rows:** cleanNum корректно парсит `-1.200,50`, но для явного флага outgoing/incoming определяется по `startsWith('-')` до очистки regex.

### 6. Unit tests

**Новый файл `automation/tests/cleannum.test.cjs` (21 test, все passing):**
- European: `1.200,50`, `1200,50`, `12.345.678,90`
- US: `1,200.50`, `1,234,567.89`
- Currency prefixes: `€500.50`, `$ 1,200.50`, `1.200,50 EUR`
- Numeric passthrough: `500.50`, `0`
- Edge cases: null, undefined, empty, whitespace, non-numeric
- Negative: `-500.50`, `-1.200,50`
- **Критический тест:** демонстрация что `parseFloat('1.200,50') === 1.2` (BUG), а `cleanNum('1.200,50') === 1200.50` (correct)

Existing reconcile tests: 23/23 pass без изменений.

### 7. CLAUDE.md — добавлена команда

`node automation/tests/cleannum.test.cjs` в разделе Node / npm / сборка.

## Верификация

- ✅ `node --check` на всех 10 изменённых файлах → OK
- ✅ `node automation/tests/cleannum.test.cjs` → 21/21 passed
- ✅ `node automation/tests/reconcile.test.cjs` → 23/23 passed (regression test)
- ✅ `npm run build` → clean dist/ generated
- ✅ grep `parseFloat` оставшиеся — только safe `.toFixed()` паттерны и CLI UI

## Затронутые файлы

**Изменены:**
- `automation/imap_daemon.cjs` (cleanNum + fileBasename dedup)
- `automation/accountant_agent.cjs` (parseAmount alias removed)
- `automation/repairman_agent.cjs` (cleanNum)
- `automation/teacher_agent.cjs` (cleanNum in CLI input)
- `automation/backfill_bank_transactions.cjs` (cleanNum)
- `automation/import_csv_bank_transactions.cjs` (cleanNum)
- `automation/reconcile_bank_statement.cjs` (cleanNum)
- `automation/search_agent.cjs` (parseAmount → cleanNum)
- `automation/api_server.cjs` (Haiku restore)
- `ecosystem.config.cjs` (PM2 hardening)
- `firestore.indexes.json` (composite index)
- `CLAUDE.md` (new test command)

**Новые:**
- `automation/tests/cleannum.test.cjs`

**Удалены:**
- `automation/supreme_supervisor.cjs`
- `automation/overseer_agent.cjs`
- `automation/ai_retry.cjs`
