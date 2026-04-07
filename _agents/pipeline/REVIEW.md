# REVIEW от Perplexity — 2026-04-07 12:53 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Решение логично структурировано по фазам без downtime, правильно использует Firestore Admin SDK для миграции и добавляет security rules без удаления старых. Миграционный скрипт с dry-run обеспечивает безопасность.  
ЗАМЕЧАНИЯ:  
1. **Отсутствуют точные ID компаний**: Нужно определить GT_ID и IDEACOM_ID (например, через `admin.firestore().collection('companies').get()`), иначе копирование companies/ сломается.  
2. **Нет обработки edge cases в миграции**: скрипт migrate_to_accounts.cjs не учитывает компании без инвойсов/транзакций, нулевые компании или конфликты accountId — добавить проверки и логи.  
3. **Security rules неполные**: Новые match /accounts/* не защищают companies/ подаккаунтов от старых правил; добавить match /invoices/{id} { allow read/write: if isMaster() || (exists(/databases/$(database)/documents/invoices/$(id)) && /* check accountId == request.resource.data.accountId */) } для будущего.  
4. **Нет верификации после миграции**: Добавить в скрипт проверку на 100% покрытие (счетчики документов до/после) и тест на случайный инвойс без accountId.  
5. **Chief Accountant Charter**: Решение не противоречит (данные остаются целыми), но требует audit после migrate --save через repairman_agent.cjs --audit-paid.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
