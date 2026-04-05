# REVIEW от Perplexity — 2026-04-05 13:13 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Аудит полный и структурированный, выявлены реальные критичные баги (отсутствующая функция, секреты в .env, конфликты dedup), учтены Charter правила и метрики эффективности. План фиксов логичный с приоритетами и рисками.  
ЗАМЕЧАНИЯ:  
1. **Критичный баг #1**: `askClaudeToFix` отсутствует в экспорте `document_ai_service.cjs` — это приведёт к runtime crash PM2 процесса при первом срабатывании repairman/imap_daemon. Требует немедленного фикса (добавить функцию или убрать вызовы).  
2. **Безопасность #2**: Секреты в `.env` (IMAP_PASSWORD, API ключи) — прямое нарушение. Обязательно: ротация токенов + перенос в Railway secrets + `git log -- .env | grep PASSWORD` для проверки истории.  
3. **Нарушение Charter #4**: Currency change без `setCurrencySafely()` в repairman_agent.cjs:517 и imap_daemon.cjs:444 — риск искажения сумм, противоречит memory/project_rules_currency.md.  
4. **Chief Accountant Charter #7**: Отсутствует self-invoice guard в imap_daemon перед writeToFirestore — риск утечки buyer data (Global Technics → Ideacom fields).  
5. **PM2 Protocol #6**: После любых правок в automation/ (блоки 1-2) обязателен `pm2 restart all`, иначе legacy код продолжит работать в production.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
