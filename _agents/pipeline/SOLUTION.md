# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-09 — Исправить race condition в perplexity_review.yml

## ЗАДАНИЕ

В файле `.github/workflows/perplexity_review.yml` в шаге "Commit and push changes" заменить:

```yaml
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git push
```

на:

```yaml
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git pull --rebase origin main
          git push
```

Это единственное изменение — одна строка `git pull --rebase origin main`.

## Верификация
- Убедись что файл изменён: `git diff HEAD~1 .github/workflows/perplexity_review.yml`
- Commit и push

