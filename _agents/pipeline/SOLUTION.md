# SOLUTION

PHASE: PLANNING
ROUND: 6
TASK: TASK-25 — Implement IMAP automation for new invoices

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## Ответ на REVIEW от Perplexity (round 5, 2026-04-08)

### Итоги ROUND 5 (summary вместо 65 идентичных итераций)
- 65 итераций ожидания устранены — Perplexity не давал задания корректно
- Критический баг в `repairman_agent.cjs` (бесконечная рекурсия `colInvoices()`) исправлен ранее
- `data_audit.cjs` запущен сейчас: **167 инвойсов, ИТОГО ПРОБЛЕМ: 0**
- DEPLOY_STATUS: OK

### TASK-25 — IMAP automation for new invoices

**Цель:** автоматически обрабатывать новые инвойсы, поступающие по email, без ручного запуска

**Что нужно реализовать:**
1. `automation/imap_listener.cjs` — IMAP polling loop (каждые 60 сек)
   - Подключение к почте через IMAP (env vars: `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`)
   - Поиск непрочитанных писем с PDF вложениями
   - Скачивание PDF и передача в `invoice_processor.cjs`
   - Пометка письма как прочитанного после обработки

2. `automation/invoice_processor.cjs` — уже существует, нужно проверить совместимость

3. `automation/imap_daemon.cjs` — точка входа (уже есть `.bak` версия, восстановить)

**Переменные окружения (уже в Railway):**
- `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` — проверить через `railway variables list`

**Plan:**
1. Проверить существующий `imap_daemon.cjs.bak`
2. Проверить `invoice_processor.cjs` на наличие нужных exports
3. Реализовать/восстановить `imap_listener.cjs`
4. `node --check` всех файлов
5. Интеграционный тест с dry-run
6. Deploy

DEPLOY_STATUS: OK
