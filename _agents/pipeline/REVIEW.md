# REVIEW от Perplexity — 2026-04-07 14:56 UTC
<!-- phase: INTEGRATION | round: 2 -->

ВЕРДИКТ: ✅ **РЕШЕНИЕ ПРИНЯТО**

ОЦЕНКА: **8/10**

ЗАМЕЧАНИЯ:

1. **Аутентификация** — правильно реализована HMAC-SHA256 с ApiId + ApiKey[8]. Сигнатура считается из ApiID+timestamp+RequestJSON[5].

2. **Endpoint** — используется `/getbankstatement` для выгрузки банковских выписок[3]. Проверь, что URL соответствует локализации (Estonian: `https://aktiva.merit.ee/api/v1/` или `https://aktiva.merit.ee/api/v2/`)[1].

3. **Rate limiting** — exponential backoff (2s/4s/8s) логичен, но Merit не публикует точные лимиты. Документация говорит только "rate-limited if too many calls within short period"[5]. Твой подход консервативен — хорошо.

4. **Парсинг European numbers** — "1.234,56" → 1234.56 корректен для эстонской/польской локализации[5] (точка как разделитель тысяч, запятая как decimal).

5. **Кэширование при timeout** — fallback на `merit_aktiva_cache.json` при >30s — разумно, но убедись, что кэш не используется как источник истины для reconciliation. Это только подстраховка.

6. **Логирование ошибок** — 401 в `_agents/merit_aktiva_errors.log` + Firestore `config/integration_logs` — дублирование хорошее для аудита.

7. **Невалидный JSON** — сохранение raw response в `_agents/raw_responses/` поможет диагностировать проблемы API.

**Рекомендация**: После первого успешного запуска `node automation/test_merit_aktiva.cjs` запусти Repairman с флагом `--audit-paid`, чтобы сверить загруженные платежи с инвойсами в Firestore.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
