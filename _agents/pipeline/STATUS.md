# STATUS — Pipeline Activity Log
Обновляется автоматически. Perplexity читает при генерации задач.

## 2026-04-08

- 2026-04-08 23:55 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, TASK-29 DONE+ПРИНЯТО — ожидаю новых задач от Perplexity
- 2026-04-08 23:42 — ✅ TASK-29 Round 3 DONE: merit_health_check.cjs обновлён — точный путь Seaded→Välised ühendused→API, /gettaxes верифицирован как health check endpoint, добавлено требование owner/admin. Все замечания REVIEW Round 14 закрыты. ПРИНЯТО Perplexity.
- 2026-04-08 23:35 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, Perplexity отказался от роли (round 15) — merit_health_check syntax OK — ожидаю новых задач
- 2026-04-08 23:24 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, Perplexity отказался от роли (round 12) — ожидаю новых задач

- 2026-04-08 — ✅ ROUND 11 WAITING — TASK-28 DONE (bundle -81%), TASK-29 не получена. Perplexity снова ответил не по теме (REVIEW.md round 9). Ожидаю нового задания.
- 2026-04-08 17:26 — ✅ Завершено: 4:DATA_AUDIT
- 2026-04-08 17:06 — ✅ Завершено: 1:TASK-24 — ### TASK-24 ⏳ IN PROGRESS
- 2026-04-08 17:03 — ✅ Завершено: 1:TASK-24 — ### TASK-24 ⏳ IN PROGRESS
- 2026-04-08 16:52 — ✅ Завершено: 1:TASK-24 — ### TASK-24 ⏳ IN PROGRESS
- 2026-04-08 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, TASK-23 APPROVED — Perplexity не дал нового задания (ответил не по теме). Ожидаю новых задач от Perplexity.

- 2026-04-08 16:31 — ✅ Завершено: 3:TASK-23 Round 3 — кнопка Tühista серая (Tailwind к
- 2026-04-08 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, TASK-23 APPROVED — ожидаю новых задач от Perplexity

### TASK-22 Round 5 — Диагностика companyId

```
=== ACCOUNTS/COMPANIES ===
account:global-technics | company_id:bP6dc0PMdFtnmS5QTX4N | name:Global Technics OÜ
account:ideacom         | company_id:vlhvA6i8d3Hry8rtrA3Z | name:Ideacom OÜ

=== TOP-LEVEL COMPANIES ===
id:bP6dc0PMdFtnmS5QTX4N | name:Global Technics OÜ
id:vlhvA6i8d3Hry8rtrA3Z | name:Ideacom OÜ

=== INVOICES COUNT ===
companyId:bP6dc0PMdFtnmS5QTX4N (GT) → 103 invoices
  top: Täisteenusliisingu AS:18, Allstore Assets OÜ:15, SIA Citadele Leasing:9, ESTMA Terminaali:9, Tele2 Eesti:8
companyId:vlhvA6i8d3Hry8rtrA3Z (Ideacom) → 64 invoices
  top: PRONTO Sp. z o.o.:15, UAB "Ursus LT":8, SIA Citadele Leasing:5, Alexela AS:5, LHV:4
```

ВЫВОД: Данные в Firestore КОРРЕКТНЫ. Subcollection IDs == top-level company IDs.
Инвойсы распределены правильно. Проблема в FRONTEND логике, не в данных.

- 2026-04-08 — ✅ TASK-23 APPROVED: кнопка "Tühista" исправлена — белый текст, рамка. PHASE→WAITING
- 2026-04-08 15:46 — ✅ Завершено: 1:TASK-23 — Кнопка "Tühista" в диалоге архивации пло
- 2026-04-08 15:30 — ✅ Завершено: 6:TASK-22 Round 6 — исправить stale selectedCompanyI
- 2026-04-08 15:26 — ✅ Завершено: 0:TASK-22 Round 5 — диагностика завершена
- 2026-04-08 18:25 — ✅ Завершено: 5:TASK-22 Round 5 — диагностика companyId выполнена (данные корректны)
- 2026-04-08 15:04 — ✅ Завершено: 4:TASK-22 Round 4 — companyId перепутан в Firestore
- 2026-04-08 14:15 — ✅ Завершено: 2:TASK-22 — Жёсткое разделение баз данных по компани
- 2026-04-08 13:29 — ✅ Завершено: 0:все задачи из BACKLOG выполнены — ожидаю новых
- 2026-04-08 — ✅ PHASE→READY ROUND:9 — ревью ROUND:8 принято, BACKLOG пуст

- 2026-04-08 10:45 — ✅ Завершено: 0:все задачи из BACKLOG выполнены — ожидаю новых
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
- 2026-04-08 13:46 — ✅ Проверка: PHASE:WAITING, BACKLOG пуст, ожидаю новых задач
webhook-test 17:10:00
- 2026-04-08 — ✅ Проверка: TASK-22 DONE, BACKLOG пуст, node --check OK, TS OK — ожидаю новых задач

- 2026-04-08 — ✅ Завершено: 1:TASK-24 Round 1 — CSV export кнопка добавлена в filters-bar (src/App.tsx). Build OK.
- 2026-04-08 — ✅ TASK-24 APPROVED Perplexity. PHASE→WAITING. BACKLOG пуст. Ожидаю новых задач.
- 2026-04-08 — ✅ Верификация: TASK-24 ✅ code present (src/App.tsx:184-464), build OK, SOLUTION.md DEPLOY_STATUS:OK — статус финальный, ожидаю новых задач от Perplexity.
