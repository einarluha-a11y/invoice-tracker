# SOLUTION

PHASE: DONE
ROUND: 8
TASK: TASK-26 — Data quality audit + partial payments tracking fix

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## TASK-26 — Результат

### Data quality audit

```
Всего инвойсов: 167
Инвойсов с неполными полями: 0
Неверных статусов: 0
Групп дубликатов: 0
Pending с нулём: 0
Неверных дат: 0

ИТОГО ПРОБЛЕМ: 0
```

### Partial payments tracking fix

**Проблема найдена:** `bank_statement_processor.cjs` при частичных платежах уменьшал `amount` но **не записывал `payments[]` array**. Из-за этого защита Ремонтника (`if existingPayments.length > 0 → не перезаписывать amount`) никогда не срабатывала.

**Исправление** (строки ~290-300):

```js
// БЫЛО:
t.update(docRef, { amount: cleanNum(newAmount.toFixed(2)), status: newStatus });

// СТАЛО:
t.update(docRef, {
    amount: cleanNum(newAmount.toFixed(2)),
    originalAmount: freshData.originalAmount || freshData.amount,
    remainingAmount: cleanNum(newAmount.toFixed(2)),
    payments: [...existingPayments, paymentEntry],  // ← новое
    status: newStatus,
});
```

Каждый частичный платёж теперь записывается в `payments[]` с полями: `date`, `amount`, `reference`, `counterparty`.

### Railway deploy status

Railway logs (2026-04-08 20:11):
- invoice-api: работает
- invoice-imap: работает (IMAP rate limited — normal, retry через 120s)
- tunnel-manager: crash loop (cloudflared не установлен) — не критично, API работает напрямую

### node --check

```
automation/bank_statement_processor.cjs — OK (после правки)
automation/imap_daemon.cjs              — OK
automation/imap_listener.cjs            — OK
automation/invoice_processor.cjs        — OK
automation/repairman_agent.cjs          — OK
```
