# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-09 — Исправить race condition в perplexity_review.yml

## ЗАДАНИЕ

В файле `.github/workflows/perplexity_review.yml` добавить `git pull --rebase origin main` перед `git push` в шаге "Commit and push changes".

## CODE

### Реализованные изменения

**`.github/workflows/perplexity_review.yml` — добавлена строка `git pull --rebase origin main`**

Шаг "Commit and push changes" теперь выглядит так:
```yaml
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git pull --rebase origin main
          git push
```

Это устраняет race condition: если между checkout и push в main появился новый коммит (например от Claude), `git push` падал с ошибкой `rejected (non-fast-forward)`. Теперь бот перед пушем подтягивает последние изменения через rebase.

### Верификация

```
git diff HEAD~1 .github/workflows/perplexity_review.yml → строка git pull --rebase origin main присутствует
```

DEPLOY_STATUS: OK
