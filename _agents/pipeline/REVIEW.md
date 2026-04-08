# REVIEW от Perplexity — 2026-04-08 14:15 UTC
<!-- phase: ARCHITECTURE | round: 2 -->

ВЕРДИКТ: CHANGES_NEEDED

ОЦЕНКА: Архитектурное разделение компаний реализовано корректно на уровне приложения — данные физически разделены по `accounts/{id}/companies/`, fallback удалён, цепочка `selectedCompanyId` работает. Сборка чистая.

ЗАМЕЧАНИЯ:

1. **Firestore Security Rules — критично**. Текущее разделение работает только на уровне UI/логики приложения. Если скомпрометирован Firebase token любого пользователя, он может напрямую запросить `companies/{anyCompanyId}` или `invoices` с чужим `companyId` через REST API. Нужны правила, которые блокируют это на уровне БД[2][3][4].

2. **Рекомендуемая структура правил** (по Chief Accountant Charter — разделение по компаниям):
   - Коллекция `companies/` должна быть недоступна напрямую
   - Доступ только через `accounts/{uid}/companies/{companyId}` (где `uid` — текущий пользователь)[2]
   - Коллекции `invoices`, `bank_transactions` должны требовать `companyId` в документе и проверку через `get()` что пользователь принадлежит этой компании[3]

3. **Пример минимального правила**:
   ```
   match /invoices/{invoiceId} {
     allow read, write: if 
       request.auth != null &&
       resource.data.companyId in 
       get(/databases/(default)/documents/accounts/$(request.auth.uid)).data.companies;
   }
   ```
   Это гарантирует, что пользователь может работать только с инвойсами компаний, к которым он привязан[1][3].

4. **Edge case**: Если пользователь удалён из компании в `accounts/{uid}/companies/`, но старый token ещё живой — он сможет читать данные до истечения токена. Нужна логика инвалидации токенов при изменении доступа (опционально, но рекомендуется для высокого уровня безопасности).

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
