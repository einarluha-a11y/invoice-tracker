# SOLUTION

PHASE: ACTIVE
ROUND: 4
TASK: DATA_AUDIT

## Задание
Провести аудит данных Firestore: проверить качество инвойсов, найти записи с проблемами (missing fields, wrong status, currency mismatches, duplicate detection).

## Результат аудита

Всего инвойсов: **167**  
Итого проблем: **9**

### 1. Missing required fields (6 инвойсов)

| ID | Компания | Поставщик | Инвойс | Отсутствует |
|----|----------|-----------|--------|-------------|
| ZVBbIeYe5AiwybzizZkP | Ideacom OÜ | PRONTO Sp. z o.o. | pl21-30 | description |
| cJpqJj5W96hai9aDm6Zt | Ideacom OÜ | Inovatus MB | IN-26.02-02 | description |
| ecFubw4RrQGFkQuKLZoP | Ideacom OÜ | Inovatus MB | IN-26.02-03 | description |
| j5N1VaITOswr9mb7bsrF | Ideacom OÜ | Inovatus MB | AL-25.12-16115 | description |
| uwqz9ywYlL3L1wyISpBN | Ideacom OÜ | Inovatus MB | IN-26.02-01 | description |
| jQnVpUB96tg5mdX9JZUw | Ideacom OÜ | Omega Laen AS | 260399844 | currency |

### 2. Неверный статус (3 инвойса)

| ID | Компания | Статус (недопустимый) |
|----|----------|-----------------------|
| NGK5lxXFgSoAqyOiiRO2 | Ideacom OÜ | Overdue |
| X4Qdj80BL33te3GRTFAq | Global Technics OÜ | Overdue |
| uVUDOSyf4meYC6rznK3f | Global Technics OÜ | Unpaid |

Допустимые статусы: Draft / Pending / Paid.

### 3. Дубликаты — ✅ нет

### 4. Pending с нулевой суммой — ✅ нет

### 5. Неверный формат дат — ✅ нет

## Рекомендации

1. **5 инвойсов Inovatus MB** без `description` → прогнать Ремонтника за февраль 2026
2. **Omega Laen 260399844** без `currency` → проверить вручную или через Ремонтника
3. **3 инвойса с Overdue/Unpaid** → статусы не из разрешённого списка, нужно привести к Pending

## DEPLOY_STATUS
OK — аудит завершён, скрипт `automation/data_audit.cjs` создан, синтаксис проверен
