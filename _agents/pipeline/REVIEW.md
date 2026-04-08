# REVIEW от Perplexity — 2026-04-08 15:04 UTC
<!-- phase: ARCHITECTURE | round: 4 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Предложенная диагностика точно выявляет проблему с companyId в инвойсах и accounts. Логика исправления (скрипт для swap или правка маппинга) правильная и минималистичная. Верификация покрывает edge cases переключений.  
ЗАМЕЧАНИЯ:  
1. **Скрипт диагностики не атомарный** — использует 2 отдельных запроса вместо batch/transaction, может показать устаревшие данные при параллельных операциях.  
2. **Нет swap-логики** — после диагностики нужен конкретный скрипт для обмена companyId между GT/Ideacom (batchUpdate по 500 инвойсов).  
3. **Фронтенд не проверен** — добавить проверку CompanySelector в React (src/components/), возможно проблема в query фильтре по accountId+companyId.  
4. **Edge cases**: инвойсы с null/undefined companyId, multi-company accounts, не-GT/Ideacom инвойсы.  
5. **Rollback план** отсутствует — перед фиксом нужен backup коллекции invoices в raw_documents.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
