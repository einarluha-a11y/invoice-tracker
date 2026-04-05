# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Усилить reconciliation rules — не допускать ложных match

## ARCHITECTURE

(одобрено в round 2)

Strict reconciliation: reference match (exact OR strong substring ≥5 chars, одна строка полностью содержит другую) + vendor word overlap (≥3 chars, после stripping legal suffixes, cities, stopwords) + amount tolerance + idempotency (skip if tx.matchedInvoiceId уже установлен). Центральный модуль `automation/core/reconcile_rules.cjs` — единый источник правил.

## CODE

### 1. automation/core/reconcile_rules.cjs (новый файл, 107 строк)

Экспортирует:
- `matchReference(invId, txRef)` → `'exact' | 'strong' | false`
  - Нормализует (lowercase, strip `\s-/`)
  - exact: a === b
  - strong: обе ≥5 chars И одна полностью содержит другую (`long.includes(short)`)
  - Никакого ratio: "pl2125" vs "pl2128" → нет containment → false, защищает PRONTO кейс
- `vendorOverlap(a, b)` → boolean
  - Tokenize: lower + \n→space + strip LEGAL_SUFFIXES + strip CITIES + strip URLs + alphanumeric
  - Filter: ≥3 chars + не stopword
  - Возвращает true если есть общий token
  - FFC LOGISTICS vs Nunner Logistics → {ffc} vs {nunner} (logistics в stopwords) → false ✅
- `matchAmount(invoice, tx)` → `'full' | 'partial' | false` (±0.05 для full)
- `canReconcile(invoice, tx)` — композиция: `{ok, reason, kind, payment}`
  - Порядок проверок: missing input → matched already → ref → vendor → amount → ok

LEGAL_SUFFIXES: OÜ/OU/AS/SA/SIA/Sp. z o.o./GmbH/LLC/Ltd/Inc/AG/BV/SRL/SPA (case insensitive, word boundary)
CITIES: Tallinn/Tartu/Narva/Pärnu/Kohtla-Järve/Warsaw/Warszawa/Riga/Vilnius/Helsinki/Stockholm/Moscow/Kiev/Kyiv
VENDOR_STOPWORDS: logistics/transport/cargo/freight/services/group/holding/international/company/solutions/systems/consulting/global/trade/trading/auto/motors/store

### 2. automation/tests/reconcile.test.cjs (новый файл, 157 строк)

23 assert-based теста (passed: 23/23):
- **matchReference** (7): exact, case-insensitive, separators, real PRONTO false positive rejected, real NUNNER diff ids rejected, strong substring allowed для Allstore B03494, short strings, empty
- **vendorOverlap** (6): FFC/NUNNER stopword filter, PRONTO pass, Allstore pass, vendorName с \n strip, empty conservative false, only stopwords false
- **matchAmount** (5): exact, tolerance, partial, over-amount, invalid
- **canReconcile** (5): real PRONTO false match rejected, real FFC cross-vendor rejected, idempotency, valid match, valid partial

Run: `node automation/tests/reconcile.test.cjs` → exit 0 если все проходят.

### 3. automation/imap_daemon.cjs — reconcilePayment()

- Import `canReconcile, matchReference, vendorOverlap` из `./core/reconcile_rules.cjs`
- `assessCandidate()` переписан:
  - БЫЛО: `refMatchScore (fuzzy includes) || vNameMatch (any word includes)` → добавлял кандидата
  - СТАЛО: `(refMatch && vendorOk)` обязательны (кроме ettemaks — vendor-only)
  - Score: exact=150, strong=75, vendor=+25, unpaid priority=+500
  - Логирует skipped vendor-only cases для аудита
- Cross-currency fallback block: заменён `vendorWords.some(...)` на `vendorOverlap(data.vendorName, bankDesc)`

### 4. automation/repairman_agent.cjs

- Import `canReconcile, matchReference, vendorOverlap` из `./core/reconcile_rules.cjs`
- `checkBankTransactions()` переписан: вместо fuzzy `includes` использует `canReconcile({invoiceId, vendorName, amount}, tx)`. Добавлена проверка `tx.matchedInvoiceId && !== invoiceId → skip` (idempotency).
- Новая функция `checkAllPaidInvoices({fix})`:
  - Обходит все `status === 'Paid'` invoices
  - Для каждого ищет matched bank tx via `where('matchedInvoiceId', '==', inv.id)`
  - Если нет → suspicious (лог)
  - Если есть но не проходит `matchReference + vendorOverlap` → revert to Overdue + clear matchedInvoiceId
  - Dry-run default, `--fix` для apply
- CLI entry: `if (hasFlag('--audit-paid'))` → запускает checkAllPaidInvoices вместо main()
- Export: добавлен `checkAllPaidInvoices`

### 5. src/data/api.ts — post-save reconciliation

- Старый fuzzy match (`txRef.includes(invoiceNum) || invoiceNum.includes(txRef)` + любое vendor word contains) заменён на strict:
  - Inline TypeScript копия helpers из reconcile_rules.cjs (STOPWORDS, LEGAL_SUFFIXES, CITIES, tokenize, matchRef, vendorOverlap)
  - Требует ОБА refOk && vendorOk
  - Idempotency: `if (tx.matchedInvoiceId && tx.matchedInvoiceId !== invoiceRef.id) continue`
  - При успешном match — обновляет `tx.matchedInvoiceId = invoiceRef.id` (закрепляет tx)
- Логика FX conversion сохранена

### 6. automation/teacher_agent.cjs

- **Vendor cleanup блок (новый, 4a):** если `vendorName.includes('\n')` → берём первую непустую линию (fixes FFC LOGISTICS\nKOHTLA-JÄRVE)
- **Math mismatch flag:** в существующем math check блоке — если subtotal + tax ≠ amount (≤0.05 tolerance, ratio в диапазоне) → устанавливает `invoice.mathMismatch = true` (non-blocking, для UI badge). Stale flag очищается если математика теперь правильная.

### 7. src/components/InvoiceTable.tsx — MATH badge

- В колонке amount рядом с суммой: если `(invoice as any).mathMismatch === true` → жёлтый inline badge "⚠ MATH" с tooltip "Subtotal + Tax ≠ Amount — требует ручной проверки"
- Стиль: background #fff3cd, border #ffc107, color #856404, fontSize 0.65rem

### 8. CLAUDE.md

Добавлены команды:
- `node repairman_agent.cjs --audit-paid [--fix]`
- `node automation/tests/reconcile.test.cjs`

## Верификация

1. **Syntax check:** `node --check` прошёл на всех CJS файлах
2. **Unit tests:** 23/23 passed
3. **Build:** `npm run build` успешен, dist готов
4. **Dry run audit:** запустим после deploy на production для выявления оставшихся false Paid

## Затронутые файлы

- `automation/core/reconcile_rules.cjs` (new)
- `automation/tests/reconcile.test.cjs` (new)
- `automation/imap_daemon.cjs`
- `automation/repairman_agent.cjs`
- `automation/teacher_agent.cjs`
- `src/data/api.ts`
- `src/components/InvoiceTable.tsx`
- `CLAUDE.md`
