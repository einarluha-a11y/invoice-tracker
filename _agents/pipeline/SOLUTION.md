# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Окончательно исправить race condition — добавить concurrency в perplexity_review.yml

## ПРОБЛЕМА

git pull --rebase не помогает — два Actions запускаются параллельно и оба пытаются пушить одновременно.

## РЕШЕНИЕ — добавить concurrency группу

В `.github/workflows/perplexity_review.yml` добавить после строки `permissions:`:

```yaml
concurrency:
  group: perplexity-review
  cancel-in-progress: false
```

Это гарантирует что только один Perplexity Review может работать одновременно.
Второй запуск будет ждать пока первый завершится.

## Полный итоговый вид начала файла:

```yaml
name: Perplexity Review

on:
  push:
    branches: [main]
    paths:
      - '_agents/pipeline/SOLUTION.md'

permissions:
  contents: write

concurrency:
  group: perplexity-review
  cancel-in-progress: false

jobs:
  review:
    ...
```

## Верификация
- `grep -A2 "concurrency" .github/workflows/perplexity_review.yml` → должно найти группу
- Commit и push

