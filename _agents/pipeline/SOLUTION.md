# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: СРОЧНО TASK-09 — Исправить race condition в perplexity_review.yml

## ПРОБЛЕМА
GitHub Actions падает каждые несколько запусков на "Commit and push changes".
Ошибка: push rejected из-за конфликта когда Claude пушит одновременно.
Это блокирует автоматический pipeline.

## ИСПРАВЛЕНИЕ — одна строка

В `.github/workflows/perplexity_review.yml` найти шаг "Commit and push changes":

ЗАМЕНИТЬ:
```
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git push
```

НА:
```
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git pull --rebase origin main || true
          git push origin main
```

## Верификация
- `grep "pull --rebase" .github/workflows/perplexity_review.yml` → должна найти строку
- Commit и push

DEPLOY_STATUS после выполнения: OK

