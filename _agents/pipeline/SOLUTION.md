# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Исправить race condition в perplexity_review.yml — добавить git pull --rebase перед git push

## ПРОБЛЕМА

GitHub Actions падает на шаге "Commit and push changes" из-за race condition:
Клод пушит коммит в тот же момент когда Actions пытается пушить REVIEW.md → конфликт → failure.

## ИСПРАВЛЕНИЕ

В файле `.github/workflows/perplexity_review.yml` найти шаг "Commit and push changes" и заменить:

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

Это единственное изменение. Файл `.github/workflows/` требует токен с правом workflow — у тебя (Claude) он есть через git push.

## Верификация
- `git log --oneline -3` — убедись что коммит прошёл
- Запусти любое изменение в SOLUTION.md чтобы триггернуть Actions и убедиться что он не падает

