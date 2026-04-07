# BACKLOG — Invoice-Tracker Pipeline

## Выполнено (НЕ повторять!)
- [x] TASK-01 — Фундамент multitenancy
- [x] TASK-02 — Frontend (Login, AuthContext, useCompanies)
- [x] TASK-03 — Backend auth middleware
- [x] TASK-04 — Cleanup старого кода
- [x] TASK-05 — Кэш правил + storage bucket
- [x] TASK-06 — Рефакторинг updateInvoice()
- [x] TASK-07 — Разбивка imap_daemon.cjs на модули
- [x] TASK-08 — Users list endpoint
- [x] TASK-09 — Race condition в workflow
- [x] TASK-10 — Perplexity не повторяет задачи

## Ожидают credentials (ПРОПУСТИТЬ)
- [ ] Merit Aktiva интеграция — ждёт API ключи
- [ ] Dropbox прямая интеграция — ждёт credentials

## Следующие задачи
- [ ] Мягкое удаление инвойсов (архив вместо delete)
- [ ] PDF экспорт списка инвойсов для бухгалтера
- [ ] Email уведомления при Overdue инвойсах
- [ ] Дашборд статистика — сводка по месяцам

## Правила
- [x] = выполнено, НИКОГДА НЕ ПОВТОРЯТЬ
- [ ] = не сделано, брать первую сверху
- "Ожидают credentials" = ПРОПУСКАТЬ
- Если все [ ] выполнены → PHASE: WAITING
