# REVIEW от Perplexity — 2026-04-07 19:16 UTC
<!-- phase: BUGFIX | round: 1 -->

ВЕРДИКТ: НЕПРАВИЛЬНОЕ РЕШЕНИЕ  
ОЦЕНКА: 1/10  
ЗАМЕЧАНИЯ:  
- **Неправильный подход**: PM2 crash loops (274/265 рестартов) и Firestore "Transaction too big" — это **кодовая ошибка**, а не PM2-конфиг. Нужно найти в коде `invoice-imap`/`invoice-api` места с большими батч-операциями Firestore (>500 docs или >10MB) и разбить на chunks по 100-200[1][2].  
- **Что искать**: `batch.commit()`, `writeBatch()`, `bulkWrite()` с `forEach` без лимитов; transaction с рекурсией/циклами.  
- **Исправление**: `for (let i=0; i<docs.length; i+=100) { batch...; await batch.commit(); batch = db.batch(); }`  
- **Нет анализа кода**: SOLUTION не содержит grep/search по "batch", "transaction", "writeBatch" в `src/` — нарушение "Найди причину в коде".  
- **Отсутствует верификация**: нет `node --check`, нет проверки `pm2 list` (0 рестартов).  
- **Не добавлено**: `DEPLOY_STATUS: OK`.  
**Рекомендация**: Перезапуск с поиском `grep -r "batch\|transaction" src/ automation/` + chunking + commit/push[3][4].

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
