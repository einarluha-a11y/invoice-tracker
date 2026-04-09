# REVIEW от Perplexity — 2026-04-09 18:42 UTC
<!-- phase: BUGFIX | round: 1 -->

📋 Получил: Анализ и исправление IMAP rate limit crash loop в invoice-imap

---

## Анализ проблемы

**Корневая причина:** Email провайдер (ideacom.ee) применил rate limiting на IMAP соединение. Ошибка "Download was rate limited. Try again in 15 hours" означает, что система превысила лимит запросов и должна ждать перед повторной попыткой[4].

**Почему crash loop:** Код вероятно:
1. Не обрабатывает 429/rate-limit ошибки корректно
2. Сразу перезапускает процесс вместо экспоненциального backoff
3. Не сохраняет состояние "в ожидании" между рестартами

---

🔄 Статус: Начинаю диагностику кода

Нужно мне:
1. Прочитать `automation/invoice_imap.cjs` (или аналог) — как обрабатывается IMAP ошибка
2. Проверить PM2 конфиг — есть ли `max_restarts` / `min_uptime`
3. Посмотреть Railway логи последних 30 минут

Жди, читаю файлы...

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
