# SOLUTION

PHASE: ARCHITECTURE
ROUND: 2
TASK: Усилить reconciliation rules — не допускать ложных match (кросс-вендор, один tx = 2 инвойса, reference fuzzy includes)

## ARCHITECTURE (round 2 — ответы на замечания round 1)

### Замечание 1: Strong substring algorithm — уточнение

Чёткий алгоритм matchReference(invId, txRef):

```
function matchReference(invId, txRef) {
  if (!invId || !txRef) return false;
  const a = String(invId).replace(/[\s\-\/]/g, '').toLowerCase();
  const b = String(txRef).replace(/[\s\-\/]/g, '').toLowerCase();
  if (a === b) return 'exact';
  // Strong substring: одна строка содержится в другой, обе ≥5 chars,
  // И длина меньшей ≥ 70% длины большей
  if (a.length >= 5 && b.length >= 5) {
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    if (long.includes(short) && short.length / long.length >= 0.7) return 'strong';
  }
  return false;
}
```

Защита от false positive "26/4211003536" vs "26/4211005197": обе normalized 14 chars,
общей полной подстроки нет (различаются в середине) → no match. PRONTO "pl21-25" vs
"pl21-28" → нормализовано "pl2125" vs "pl2128", один не содержит другой → no match.

### Замечание 2: Vendor word overlap — детализация + stopwords

```
const LEGAL_SUFFIXES = /\b(o[uü]|as|sa|sia|sp\.?\s*z\s*o\.?\s*o\.?|gmbh|llc|ltd|inc|ag|bv|srl|spa)\b/gi;
const CITIES = /\b(tallinn|tartu|narva|kohtla[\s-]?j[aä]rve|warsaw|warszawa|riga|vilnius|helsinki|stockholm)\b/gi;
const VENDOR_STOPWORDS = new Set([
  'logistics', 'transport', 'trans', 'cargo', 'freight', 'services', 'service',
  'group', 'holding', 'international', 'company', 'solutions', 'systems',
  'consulting', 'global', 'trade', 'trading', 'auto', 'motors'
]);

function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(CITIES, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zа-яёõäöü0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !VENDOR_STOPWORDS.has(w));
}

function vendorOverlap(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return false;  // не можем верифицировать — skip
  return [...sa].some(x => sb.has(x));
}
```

**Тест FFC vs NUNNER:**
- A "FFC LOGISTICS": {ffc} (logistics — stopword)
- B "Nunner Logistics": {nunner}
- common: ∅ → **no match** ✅

**Тест PRONTO vs PRONTO:**
- {pronto} ∩ {pronto} = {pronto} → match ✅

**Тест ALLSTORE ASSETS vs ALLSTORE:**
- {allstore, assets} ∩ {allstore} = {allstore} → match ✅

### Замечание 3: Repairman batch audit — добавляем `--audit-paid`

Новая функция checkAllPaidInvoices() в repairman_agent.cjs:

```
async function checkAllPaidInvoices({ fix }) {
  const paid = await db.collection('invoices').where('status', '==', 'Paid').get();
  const { matchReference, vendorOverlap } = require('./core/reconcile_rules.cjs');
  let reverted = 0, suspicious = 0;
  for (const inv of paid.docs) {
    const d = inv.data();
    const txSnap = await db.collection('bank_transactions')
      .where('matchedInvoiceId', '==', inv.id).get();
    if (txSnap.empty) { suspicious++; console.log(`[audit] ${inv.id}: Paid without bank link`); continue; }
    const tx = txSnap.docs[0].data();
    const refOk = matchReference(d.invoiceId, tx.reference);
    const vendorOk = vendorOverlap(d.vendorName, tx.counterparty);
    if (!refOk || !vendorOk) {
      console.log(`[audit] REVERT ${inv.id}: ref=${refOk} vendor=${vendorOk}`);
      if (fix) {
        await inv.ref.update({ status: 'Overdue' });
        await txSnap.docs[0].ref.update({ matchedInvoiceId: null });
      }
      reverted++;
    }
  }
  console.log(`[audit] ${reverted} reverts, ${suspicious} suspicious (no link). fix=${fix}`);
}
```

CLI: `node repairman_agent.cjs --audit-paid` (dry-run), `--audit-paid --fix` (LIVE).

### Замечание 4: Math validation — UI badge, не в Accountant

1. **Teacher post-enrichment check:** если `subtotal > 0 && tax >= 0 && Math.abs(subtotal + tax - amount) > 0.05` → set `mathMismatch: true` на invoice doc (non-blocking)
2. **UI:** InvoiceCard.tsx показывает жёлтый badge "⚠ MATH" с tooltip, если `invoice.mathMismatch === true`
3. **Accountant extraction:** НЕ меняем (избегаем hallucination — не генерим недостающие поля)

### Замечание 5: Unit tests — `automation/tests/reconcile.test.cjs`

```
const assert = require('assert');
const { matchReference, vendorOverlap, canReconcile } = require('../core/reconcile_rules.cjs');

// Reference
assert.strictEqual(matchReference('pl21-25', 'PL21-25'), 'exact');
assert.strictEqual(matchReference('pl21-28', 'PL21-25'), false);
assert.strictEqual(matchReference('26/4211005197', '25/4211016350'), false);
assert.strictEqual(matchReference('allstore-b03494', 'B03494'), 'strong');

// Vendor
assert.strictEqual(vendorOverlap('FFC LOGISTICS', 'Nunner Logistics'), false);
assert.strictEqual(vendorOverlap('Pronto Logistyka', 'PRONTO LOGISTYKA Sp. z o.o.'), true);

// canReconcile composition
assert.strictEqual(canReconcile(
  { invoiceId: 'pl21-28', vendorName: 'PRONTO', amount: 3600 },
  { reference: 'PL21-25', counterparty: 'PRONTO', amount: 3600, matchedInvoiceId: null }
), false, 'diff ref → no match');

console.log('✅ All reconcile tests passed');
process.exit(0);
```

Запуск: `node automation/tests/reconcile.test.cjs`. Добавляем в CLAUDE.md как опциональную диагностическую команду.

### Замечание 6: Firestore index — НЕ нужен

Текущий query pattern: single-field `where('matchedInvoiceId', '==', X)`. Firestore авто-индексирует single fields — composite не требуется. Composite нужен только для multi-field where или where+orderBy.

### Финальная архитектура — центральный модуль

`automation/core/reconcile_rules.cjs` — единый источник правил:
- `matchReference(invId, txRef)` — 'exact' | 'strong' | false
- `vendorOverlap(invVendor, txCounterparty)` — boolean
- `canReconcile(invoice, tx)` — композиция: refMatch && vendorOverlap && amountCheck && !tx.matchedInvoiceId

**Call sites:**
- `automation/imap_daemon.cjs` → reconcilePayment() использует canReconcile
- `automation/repairman_agent.cjs` → checkBankTransactions() + checkAllPaidInvoices()
- `src/data/api.ts` → post-save reconciliation (дублируем логику в TS или inline import)

### План реализации (CODE phase)

1. **automation/core/reconcile_rules.cjs** (новый, ~100 строк)
2. **automation/imap_daemon.cjs** — reconcilePayment() переписать на canReconcile
3. **automation/repairman_agent.cjs** — checkBankTransactions + новый checkAllPaidInvoices
4. **src/data/api.ts** — post-save reconciliation с теми же правилами
5. **automation/teacher_agent.cjs** — legal name rule: strip \n+city из vendorName; math validation (mathMismatch flag)
6. **src/components/InvoiceCard.tsx** — MATH badge
7. **automation/tests/reconcile.test.cjs** — unit tests
8. **CLAUDE.md** — добавить `node automation/tests/reconcile.test.cjs` и `node repairman_agent.cjs --audit-paid` в список команд

### Учтённые риски

1. Stopwords список может потребовать расширения (начинаем базовым, расширяем по отчётам)
2. Legal suffix regex покрывает EE/PL/DE/RU/UK — экзотические типы добавим по мере появления
3. Repairman audit — dry-run default, `--fix` только после user confirmation
4. 70% threshold strong substring может резать реальные варианты формата reference — логгируем все skipped для аудита первую неделю
