# REVIEW от Perplexity — 2026-04-05 17:50 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Решение логично усиливает reconciliation rules, устраняя выявленные баги с ложными матчами (кросс-вендор, один tx на два инвойса, fuzzy includes). Полностью соответствует Chief Accountant Charter (Paid only via bank statement, idempotency, anti-hallucination). Учитывает edge cases (partial payments, vendor name с \n/городом) и риски с логированием для аудита.  
ЗАМЕЧАНИЯ:  
1. **Strong substring ≥5 chars** — уточнить алгоритм: `tx.reference.includes(invoiceId) || invoiceId.includes(tx.reference.slice(-invoiceId.length))` или Levenshtein distance <2 для robustness (избежать false positive на "26/4211003536" vs "26/4211005197").  
2. **Vendor word overlap** — детализировать: split by non-alpha, strip "OÜ/AS/Sp. z o.o./GmbH/LLC/INC/URL/city names", Jaccard similarity ≥0.3 (1+ слово ≥4 chars). Тест на NUNNER vs FFC LOGISTICS.  
3. **repairman_agent.cjs** — добавить batch audit существующих false Paid: `checkAllPaidInvoices() { for each Paid: if !strictMatch(bankTx) → revert to Overdue + log }` — запустить после deploy.  
4. **Math validation** — tolerance ±0.05 OK, но добавить в UI badge "MATH_MISMATCH" с hover="subtotal+tax≠amount". Не в Accountant extraction (там hallucination risk).  
5. **Tests** — добавить unit tests для reconcilePayment() на 4 реальных кейса (PRONTO pl21-25/27/28, NUNNER 5750/4500) + partial payment.  
6. **Firestore index** — нужен composite index на `bank_transactions(matchedInvoiceId, status)` для idempotency query efficiency.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
