# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Усилить reconciliation rules — не допускать ложных match (кросс-вендор, один tx = 2 инвойса, reference fuzzy includes)

## ARCHITECTURE

### Анализ задачи

Обнаружен баг в reconcilePayment() и post-save reconciliation в api.ts — алгоритм слишком liberal, марки инвойсы как Paid по ложным совпадениям:

Реальные кейсы:
1. **PRONTO pl21-25 tx 3600 EUR** → matched к pl21-27 И pl21-28 (оба получили Paid, хотя реально оплачен только pl21-25). Один tx примачен к двум инвойсам
2. **NUNNER tx 5750 EUR ref 26/4211003536** → matched к FFC LOGISTICS 260305 (кросс-вендор, разные поставщики, совпала только сумма)
3. **NUNNER tx 4500 EUR ref 25/4211016350** → matched к NUNNER 26/4211005197 (разные номера инвойсов, fuzzy includes)

Первопричины:
- reconcilePayment() — match по amt + vendor fuzzy, без strict reference check
- Нет защиты "один bank tx = один matched invoice"
- Нет обязательной проверки совпадения tx.counterparty с invoice.vendorName
- Reference matching через .includes() даёт false positives на похожих номерах

### Выбранное решение

Ужесточить reconciliation condition с AND по 4 правилам:

1. **Reference strict**: exact match ИЛИ strong substring (≥5 символов, invoiceId полностью содержится в tx.reference или наоборот)
2. **Idempotency**: если tx.matchedInvoiceId != null → skip (один tx = один матч)
3. **Vendor word overlap**: обязательное совпадение как минимум 1 общего слова ≥4 символов (stripping legal suffixes, URL, whitespace)
4. **Amount tolerance**: ±0.05 EUR для exact, либо amount < invoice.amount для partial payment

### План реализации

1. **automation/imap_daemon.cjs — reconcilePayment()**
   - Добавить `if (existingTx.matchedInvoiceId)` → skip
   - Усилить reference match: exact OR strong substring (≥5 chars)
   - Vendor overlap check обязателен
   - Логировать причину skip/match

2. **src/data/api.ts — post-save reconciliation**
   - Strict ref check (не голый .includes())
   - Vendor overlap requirement
   - Idempotency: tx не matched to another invoice

3. **automation/repairman_agent.cjs — checkBankTransactions()**
   - Те же правила: strict ref + vendor overlap + matchedInvoiceId skip

4. **automation/teacher_agent.cjs — legal name rule fix**
   - Если vendorName содержит \n — брать первую строку перед legal name search
   - Если vendorName содержит город через \n — strip city (evристика: слова типа KOHTLA, TALLINN, WARSAW удалить)

5. **Math validation в Accountant**
   - Если subtotal + tax !== amount (>0.05 tolerance) — добавить validationWarning "MATH_MISMATCH"
   - Не блокировать запись, но помечать для ручной проверки

### Учтённые протоколы Charter

- Paid only via bank statement (правило остаётся)
- Idempotency: один tx = один matched invoice (новое)
- Anti-hallucination: never match on amount alone
- Three-line defense: Scout + Repairman + Manual — все с одной строгой логикой

### Риски

1. **Упустим легитимные оплаты** — если vendorName с ошибкой, не примачется. Смягчение: лог "skipped: vendor mismatch", Repairman audit поймает
2. **Partial payments** — правило остаётся (amount < invoice.amount → уменьшить amount, status Overdue)
3. **Существующие false Paid** — 4 случая уже откачены (pl21-27, pl21-28, 260305, 26/4211005197). Для полной чистоты нужен audit всех Paid invoices — отдельная операция

### Что НЕ меняем

- Схему документов
- Основной flow reconcilePayment (только усиляем условия)
- Partial payment logic
