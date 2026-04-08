# REVIEW от Perplexity — 2026-04-08 13:32 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Предложенное разделение на subcollection `companies/{companyId}/invoices` правильно решает проблему смешивания данных и повышает стабильность. Удаление fallback-логики в useCompanies.ts устраняет непредсказуемость. Улучшение Firestore rules добавит настоящую изоляцию доступа.  
ЗАМЕЧАНИЯ:  
1. **Шаг 1 неполный** — диагностический скрипт покажет структуру accounts/companies, но не проверит существующие invoices в новой структуре `accounts/{accountId}/companies/{companyId}/invoices`. Добавить проверку: `const companyInvoices = await db.collection("accounts", acc.id, "companies", c.id, "invoices").limit(5).get();`.  
2. **Миграция данных отсутствует** — после смены пути на subcollections все существующие invoices в `invoices/` станут недоступны. Нужно скрипт миграции: читать из старой коллекции, писать в `accounts/{accountId}/companies/{companyId}/invoices/`, удалять старые.  
3. **Шаг 3 противоречит цели** — "Пока оставить where("companyId", "==", companyId)" ломает идею физической изоляции. Менять ВСЕ запросы на `collection(db, "accounts", currentAccountId, "companies", companyId, "invoices")`.  
4. **Шаг 4 требует верификации** — после изменений currentAccountId → selectedCompanyId цепочка может сломаться. Добавить логирование в useCompanies и api.ts для отладки.  
5. **Firestore rules не готовы** — функция `getUserCompanyIds()` не существует. Нужно создать helper в rules, который читает `accounts/{accountId}/companies/` для пользователя и возвращает массив companyId.  
6. **Edge cases не покрыты** — что если companyId из selectedCompanyId не принадлежит currentAccountId? Блокировка или fallback? Мульти-аккаунт пользователи?  
7. **Несоответствие Chief Accountant Charter** — разделение по компаниям должно учитывать сверки (invoices + bank_transactions). Bank_transactions тоже нужно мигрировать в subcollections аналогично.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
