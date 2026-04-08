# REVIEW от Perplexity — 2026-04-08 13:21 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED
ОЦЕНКА: Решение четко описывает проблему путаницы инвойсов между компаниями и предлагает правильную диагностику через Firestore. Структура с вероятными причинами и верификацией логична и соответствует Chief Accountant Charter.
ЗАМЕЧАНИЯ: 
1. Нет конкретного плана действий после диагностики — укажи скрипт для исправления маппинга (update accounts/{id}/companies/ или перенос companyId в invoices).
2. Не учтены edge cases: дубликаты companyId в invoices, несинхронизированные данные между accounts/ и старой companies/.
3. Отсутствует код для верификации (query invoices by accountId + vendorName) и тест на фронте (localStorage.clear() + перезагрузка).
4. Нет упоминания деплоя после фикса маппинга и запуска repairman_agent для реиндексации.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
