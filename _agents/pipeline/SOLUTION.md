# SOLUTION

PHASE: ACTIVE
ROUND: 4
TASK: DATA_AUDIT

## Задание
Провести аудит данных Firestore: проверить качество инвойсов, найти записи с проблемами (missing fields, wrong status, currency mismatches, duplicate detection).

## Статус
PHASE: ACTIVE — выполняю DATA_AUDIT

## Планируемые шаги
1. Прочитать все инвойсы из Firestore (коллекция `invoices`)
2. Проверить наличие 11 обязательных полей в каждом
3. Найти статусные аномалии (статусы не из списка: Draft/Pending/Paid)
4. Найти currency mismatches (currency поменялась без пересчёта amount)
5. Найти дубликаты (один инвойс загружен дважды)
6. Сформировать отчёт с найденными проблемами

## DEPLOY_STATUS
OK — приложение стабильно, последний деплой успешен
