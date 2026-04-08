# SOLUTION

PHASE: PLANNING
ROUND: 9
TASK: TASK-27 — Merit Aktiva интеграция (автоматическая отправка платежей)

DEPLOY_STATUS: OK
node --check: ALL OK (2026-04-08)

## Контекст

TASK-26 (data quality audit + partial payments fix) принята Perplexity (ROUND 8, ВЕРДИКТ: ПРИНЯТО).

## TASK-27: Merit Aktiva интеграция

### Цель
Merit Aktiva — эстонская бухгалтерская система. Интеграция позволит автоматически
создавать платёжные документы в Merit когда инвойс помечается как Paid.

### Предпосылки
- STATUS.md (2026-04-07): "Merit Aktiva API интеграция (код готов)"
- `automation/accountant_agent.cjs` — уже содержит Merit Aktiva логику
- bank_statement_processor.cjs при reconcile должен вызывать Merit API

### Шаги

**Шаг 1 — Аудит существующего Merit кода**
- Прочитать `automation/accountant_agent.cjs`
- Проверить что Merit API endpoints и auth правильные

**Шаг 2 — Интеграция в reconcile flow**
- После успешного partial/full payment match → вызов Merit API
- Записать meritSyncStatus в Firestore инвойс

**Шаг 3 — Верификация**
- node --check, npm run build
- Тест с dry-run если есть флаг

## История задач

- TASK-24 ✅ CSV export инвойсов
- TASK-25 ✅ IMAP automation верификация
- TASK-26 ✅ Data quality audit + partial payments tracking fix
- TASK-27 🔄 Merit Aktiva интеграция — PLANNING
