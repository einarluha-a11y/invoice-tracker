# SOLUTION

PHASE: PLANNING
ROUND: 7
TASK: TASK-26 — Data quality audit и автоматизация partial payments matching

## Статус системы
- Railway: Express на порту 8080, IMAP daemon работает (rate limit — норма)
- Инвойсы: 167+ в Firestore
- Frontend/Backend: задеплоены, работают
- DEPLOY_STATUS: OK

## TASK-26: Data quality audit и partial payments matching

### Проблема
1. Нет автоматической проверки качества данных инвойсов (пропущенные поля, невалидные суммы)
2. Partial payments матчинг делается вручную — банковские транзакции не сопоставляются автоматически

### Шаги

**Шаг 1 — Data quality audit**
- Запустить full_audit.cjs для анализа всех инвойсов
- Найти инвойсы с пропущенными обязательными полями
- Исправить через Ремонтника

**Шаг 2 — Анализ partial payments**
- Проверить bank_transactions коллекцию
- Найти транзакции без совпадения с invoiceId
- Предложить автоматическое правило матчинга

**Шаг 3 — Автоматизация (если аудит даст ясную картину)**
- Добавить в imap_daemon.cjs или repairman_agent.cjs автоматический partial payment trigger

## История задач
- TASK-25: IMAP автоматизация — DONE ✅
- TASK-24: Azure Document Intelligence migration — DONE ✅
- TASK-23: Cross-validation Teacher pipeline — DONE ✅
- TASK-22: Repairman refactor — DONE ✅
- TASK-26: Data quality audit + partial payments matching — PLANNING 🔄
