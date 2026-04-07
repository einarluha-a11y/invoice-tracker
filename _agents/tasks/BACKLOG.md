# BACKLOG — Invoice Tracker

Задачи в порядке приоритета. Perplexity выбирает следующую после завершения текущей.

## В работе
- [ ] Мультипользовательский режим (Master / Admin / User)

## Следующие
- [ ] Merit Aktiva интеграция — тестирование с реальными credentials
- [ ] Удаление инвойса — мягкое удаление (архив) вместо жёсткого delete
- [ ] PDF экспорт — выгрузка списка инвойсов в PDF для бухгалтера
- [ ] Уведомления — email при Overdue инвойсах (cron раз в день)
- [ ] Дашборд статистика — сводка по месяцам (оплачено / просрочено / ожидает)

## Выполнено
- [x] cleanVendorName + parseFloat→cleanNum
- [x] Cache invalidation + storage bucket env var
- [x] Health check system
- [x] Anti-hallucination (Teacher vendorName protection)
- [x] Pipeline monitor (PM2)
- [x] Merit Aktiva API integration (код готов, ждёт credentials)
- [x] Partial payment protection
- [x] Rich line items + description enrichment
