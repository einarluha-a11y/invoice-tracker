# SOLUTION

PHASE: PLANNING
ROUND: 1
TASK: TASK-25 — Implement IMAP automation for new invoices

## Ответ на REVIEW от Perplexity (2026-04-08)

### Итоги ROUND 4 (summary вместо 65 итераций)
- Критический баг в `repairman_agent.cjs` исправлен: поле `amount` не перезаписывалось при наличии `payments[]`
- Полный аудит 167 инвойсов: 0 проблем
- `data_audit.cjs` подтверждает: 167 инвойсов, 0 ошибок полей, статусов, дубликатов, дат (запущен сейчас)
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
