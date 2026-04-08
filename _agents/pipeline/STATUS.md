# STATUS — Pipeline Activity Log

Обновляется автоматически. Perplexity читает при генерации задач.

## 2026-04-08

- 2026-04-08 10:32 — ✅ Завершено: 0:все задачи из BACKLOG выполнены — ожидаю новых
- 2026-04-08 10:29 — ✅ Завершено: 1:TASK-08 — ### TASK-08 ⏳ WAITING
- 2026-04-08 10:27 — ✅ Завершено: 1:TASK-08 — ### TASK-08 ⏳ WAITING
- 2026-04-08 10:04 — ✅ Завершено: 1:TASK-20 — Заменить polling на GitHub Webhook
- 2026-04-08 09:55 — ✅ Завершено: 1:TASK-20 — Заменить polling на GitHub Webhook (мгно
- 2026-04-08 09:47 — ✅ Завершено: 1:TASK-19 — Исправить все проблемы найденные при рев
- 2026-04-08 08:36 — ✅ Завершено: 1:TASK-18 — Вернуть два dropdown в хедер (аккаунт +
- 2026-04-08 08:32 — ✅ Завершено: 1:TASK-16 — Добавить concurrency group в perplexity_
- 07:16 — pipeline_monitor переведён на spawn (неблокирующий) — monitor отзывчив пока Claude CLI работает
- 07:04 — watchdog: hang detection 30→10 мин, Perplexity timeout 10 мин
- 05:00 — watchdog.cjs создан как PM2 процесс — независимый супервизор
- 04:30 — watch отключен для invoice-api/imap — устранён crash loop
- 04:22 — pipeline_monitor: auto-deploy после Claude CLI (git pull + pm2 restart)
- 04:13 — perplexity_review.py: детерминированный выбор из BACKLOG, git log в промпте

## 2026-04-07

- Аудит кода: cleanVendorName, parseFloat→cleanNum, getVendorAliases→utils
- Anti-hallucination: Teacher не подменяет vendorName
- Partial payment protection в Repairman
- Health check система
- Merit Aktiva API интеграция (код готов)
- Pipeline monitor как PM2 процесс
- PM2 локальный деплой вместо Railway
# Webhook test Wed Apr  8 13:09:10 EEST 2026
