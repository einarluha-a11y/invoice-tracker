# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-16 — Добавить concurrency group в perplexity_review.yml

## ЗАДАНИЕ

В `.github/workflows/perplexity_review.yml` добавить после строки `permissions:`:

```yaml
concurrency:
  group: perplexity-review
  cancel-in-progress: false
```

Это единственное изменение. Гарантирует что только один Perplexity Review работает одновременно — второй ждёт пока первый завершится. Навсегда закрывает race condition.

## Верификация
- `grep -A2 "concurrency" .github/workflows/perplexity_review.yml` → находит группу
- Commit и push

