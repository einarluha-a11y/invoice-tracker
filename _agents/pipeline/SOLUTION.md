# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Исправить race condition в perplexity_review.yml — добавить git pull --rebase перед git push

## ПРОБЛЕМА

GitHub Actions падал на шаге "Commit and push changes" из-за race condition:
Клод пушит коммит в тот же момент когда Actions пытается пушить REVIEW.md → конфликт → failure.

## ИСПРАВЛЕНИЕ

В файле `.github/workflows/perplexity_review.yml` добавлена строка `git pull --rebase origin main` перед `git push`:

```yaml
          git commit -m "perplexity: review ${PHASE:-unknown} round ${ROUND:-1} + next task"
          git pull --rebase origin main
          git push
```

## Верификация
- Изменение применено в `.github/workflows/perplexity_review.yml` строка 43
- node --check: не применимо (YAML файл)

DEPLOY_STATUS: OK
