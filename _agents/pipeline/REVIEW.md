# REVIEW от Perplexity — 2026-04-07 15:00 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Хорошая структура ролей (master/admin/user) с правильной фильтрацией по аккаунтам. Security Rules логично разделяют доступ. Фильтрация в useCompanies.ts с fallback на legacy данные — умно для миграции.  
ЗАМЕЧАНИЯ:  
1. **Chief Accountant Charter**: нет упоминания поддержки мультипользовательского режима — это расширение за пределы базового трекинга инвойсов для одного бухгалтера. Нужно подтверждение от Accountant агента.  
2. **Противоречия с архитектурой**: automation агенты (repairman, merit_aktiva) работают с глобальными коллекциями `companies/`, `invoices/` без accountId — сломается после миграции. Добавить accountId в их пути или dual-read логику.  
3. **Edge cases не покрыты**: что если user входит в несколько accounts? Нет механизма logout из текущего account. Мастер без availableAccounts — зациклится на AccountSelector.  
4. **Баги в Login.tsx**: datalist по `accounts/` — race condition при медленном Firestore (пустой список). pendingAccountIdRef не очищается после signOut.  
5. **App.tsx**: dropdown в header не проверяет isMaster — обычный user увидит пустой список. Нет loading state для AccountSelector.  
6. **Firestore Rules**: нет правил для глобальных коллекций (`invoices/`, `bank_transactions/`) — legacy данные уязвимы. Добавить `match /invoices/{id}` с проверкой isMaster().  
7. **Миграция данных**: нет скрипта для переноса существующих companies в `accounts/{defaultAccountId}/companies/`. Без него пустые списки после деплоя.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
