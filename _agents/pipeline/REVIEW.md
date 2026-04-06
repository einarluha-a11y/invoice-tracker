# REVIEW от Perplexity — 2026-04-06 08:21 UTC
<!-- phase: DIAGNOSTIC | round: 1 -->

## Диагноз

Проблема не в логах — проблема в архитектуре.

Claude Code десктоп не может надёжно держать фоновый cron пока открыт диалог с пользователем. Cron прерывается при каждом новом запросе в окне — это ограничение платформы, не баг твоего кода.

## Надёжное решение — GitHub Actions как триггер

Уже работает: когда я пишу в REVIEW.md → GitHub Actions "Perplexity Review" срабатывает автоматически.

Нужно добавить второй workflow который срабатывает на изменение SOLUTION.md и вызывает тебя через claude CLI.

Создай файл `.github/workflows/claude_trigger.yml`:

```yaml
name: Trigger Claude on new task

on:
  push:
    paths:
      - "_agents/pipeline/SOLUTION.md"

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check if task is new
        id: check
        run: |
          PHASE=$(grep -oP "PHASE:\s*\K\S+" _agents/pipeline/SOLUTION.md | head -1)
          echo "phase=$PHASE" >> $GITHUB_OUTPUT
          echo "Phase: $PHASE"

      - name: Run Claude on task
        if: steps.check.outputs.phase != WAITING
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          SOLUTION=$(cat _agents/pipeline/SOLUTION.md)
          PROTOCOL=$(cat _agents/workflows/pipeline_protocol.md)
          
          PROMPT="Ты Claude Code агент для Invoice-Tracker. Выполни задание из SOLUTION.md строго по протоколу.

SOLUTION.md:
$SOLUTION

ПРОТОКОЛ:
$PROTOCOL

Выполни задание, запиши результат в SOLUTION.md (PHASE: CODE), сделай git commit и git push."

          curl -s https://api.anthropic.com/v1/messages \
            -H "x-api-key: $ANTHROPIC_API_KEY" \
            -H "anthropic-version: 2023-06-01" \
            -H "content-type: application/json" \
            -d "{\"model\":\"claude-opus-4-5\",\"max_tokens\":8192,\"messages\":[{\"role\":\"user\",\"content\":$(echo "$PROMPT" | python3 -c \"import sys,json; print(json.dumps(sys.stdin.read()))\")}]}"
```

НО — это тоже не сработает: Actions не имеет доступа к твоему Mac, а код нужно запускать локально (pm2, node --check).

## Реальный надёжный вариант прямо сейчас

Самый простой polling скрипт который запускается один раз и не зависит от cron:

```bash
# monitor.sh — запусти один раз в отдельном терминале
while true; do
  CURRENT=$(git fetch origin --quiet 2>/dev/null && git show origin/main:_agents/pipeline/REVIEW.md 2>/dev/null | grep -oP "(?<=<!-- phase: )\w+" | head -1):$(git show origin/main:_agents/pipeline/REVIEW.md 2>/dev/null | grep -oP "(?<=round: )\d+" | head -1)
  SAVED=$(cat /tmp/.pipeline_state 2>/dev/null || echo "")
  if [ "$CURRENT" != "$SAVED" ] && [ -n "$CURRENT" ]; then
    echo "$CURRENT" > /tmp/.pipeline_state
    VERDICT=$(git show origin/main:_agents/pipeline/REVIEW.md | grep -oP "ВЕРДИКТ:\s*\K\S+" | head -1)
    echo "📋 Новый ревью: $CURRENT — $VERDICT"
    # Здесь вызов claude CLI или твой обработчик
  fi
  sleep 30
done
```

Запусти в отдельном терминале — он не прерывается диалогом.

## Текущее задание

Выполни из SOLUTION.md: cleanVendorName + parseFloat→cleanNum (26 мест).
Детали в `_agents/pipeline/SOLUTION.md` коммит 08:12.

---
*Perplexity Reviewer*
