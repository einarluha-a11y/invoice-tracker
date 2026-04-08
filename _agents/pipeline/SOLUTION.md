# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: КРИТИЧНО — исправить perplexity_review.py чтобы читал BACKLOG и не повторял выполненные задачи

## ПРОБЛЕМА

perplexity_review.py генерировал задания через Perplexity API (LLM), который не всегда следовал инструкциям про BACKLOG.
Результат — повторение одних и тех же задач (TASK-02, мягкое удаление и т.д.).

## ИСПРАВЛЕНИЕ

В `.github/scripts/perplexity_review.py` изменена логика:

### Новые функции

**`get_next_task_from_backlog(backlog)`**
- Детерминированно парсит BACKLOG.md построчно
- Пропускает секцию "Ожидают credentials"
- Возвращает `(task_id, task_text)` первой строки с `[ ]`
- Возвращает `(None, None)` если всё выполнено

**`assign_next_task_number(backlog)`**
- Находит максимальный TASK-XX номер в BACKLOG
- Возвращает следующий (TASK-11, TASK-12 и т.д.)

**`mark_task_done_in_backlog(task_field)`**
- При DEPLOY_STATUS: OK — находит задачу по TASK-XX номеру или текстовому совпадению
- Меняет `[ ]` → `[x]` в BACKLOG.md

### Изменение DEPLOY_STATUS: OK flow

До: Perplexity сам выбирал следующую задачу из BACKLOG (ненадёжно)
После:
1. `mark_task_done_in_backlog()` — отмечает текущую задачу выполненной
2. `get_next_task_from_backlog()` — **детерминированно** берёт следующую `[ ]` задачу
3. Если задач нет → PHASE: WAITING
4. Perplexity **расширяет конкретную задачу** в полный SOLUTION.md (не выбирает!)

## Верификация

- `python3 -c "import ast; ast.parse(open('.github/scripts/perplexity_review.py').read()); print('OK')"` — синтаксис чистый
- get_next_task_from_backlog на реальном BACKLOG: возвращает "Мягкое удаление инвойсов (архив вместо delete)", пропускает "Ожидают credentials" ✓
- При всех [x] в BACKLOG → возвращает (None, None) → PHASE: WAITING

DEPLOY_STATUS: OK
