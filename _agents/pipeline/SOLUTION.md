# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Отключить автогенерацию задач в perplexity_review.py

## ПРАВИЛО (утверждено Einar)

Все задания для Claude пишет только Perplexity вручную через SOLUTION.md.
perplexity_review.py НЕ должен генерировать следующие задания самостоятельно.

## ИЗМЕНЕНИЕ

В `.github/scripts/perplexity_review.py`:

1. Убрать логику генерации следующего задания после DEPLOY_STATUS: OK
2. После DEPLOY_STATUS: OK — записать в SOLUTION.md только:

```
# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: Ожидаю следующее задание от Perplexity
```

3. В REVIEW.md написать только ревью выполненного задания — без "next task" в конце

## Верификация
- `grep -n "next task\|BACKLOG\|generate" .github/scripts/perplexity_review.py`
- Убедиться что логика генерации задач удалена

