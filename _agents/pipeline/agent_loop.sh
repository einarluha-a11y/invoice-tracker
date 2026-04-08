#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Invoice Tracker — автономный пайплайн Claude ↔ Perplexity
# Проверяет GitHub каждые 30 сек, запускает Claude CLI при изменениях
# ═══════════════════════════════════════════════════════════════

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"
PROJECT="/Users/einarluha/Downloads/invoice-tracker"
STATE_SOL="/tmp/.pipeline_solution_state"
STATE_REV="/tmp/.pipeline_review_state"
LOG="/tmp/pipeline-agent.log"

cd "$PROJECT" || exit 1

echo "[$(date)] Pipeline agent started" >> "$LOG"

while true; do
    git fetch origin main --quiet 2>/dev/null

    # ── 1. Проверить SOLUTION.md (новые задания) ──────────────
    SOLUTION=$(git show origin/main:_agents/pipeline/SOLUTION.md 2>/dev/null)
    PHASE=$(echo "$SOLUTION" | sed -n 's/^PHASE: *//p' | head -1)
    ROUND=$(echo "$SOLUTION" | sed -n 's/^ROUND: *//p' | head -1)
    SAVED=$(cat "$STATE_SOL" 2>/dev/null)
    NEW="SOLUTION:${PHASE}:${ROUND}"

    if [ "$NEW" != "$SAVED" ] && [ -n "$PHASE" ] && [ "$PHASE" != "WAITING" ] && ! echo "$SOLUTION" | grep -q "DEPLOY_STATUS: OK"; then
        echo "$NEW" > "$STATE_SOL"
        echo "[$(date)] 📋 Новое задание: $PHASE round $ROUND" >> "$LOG"

        claude --dangerously-skip-permissions -p \
            "Ты — автономный агент Invoice Tracker. Рабочая директория: $PROJECT
Прочитай файл _agents/pipeline/SOLUTION.md из origin/main (git show origin/main:_agents/pipeline/SOLUTION.md).
Выполни задание. Соблюдай протоколы из _agents/workflows/pipeline_protocol.md и CLAUDE.md.
После выполнения: node --check всех изменённых файлов, добавь DEPLOY_STATUS: OK в конец SOLUTION.md, закоммить и запуши в main.
Язык: русский. Коротко и по делу." \
            --max-turns 50 >> "$LOG" 2>&1

        echo "[$(date)] ✅ Задание $PHASE round $ROUND завершено" >> "$LOG"
    fi

    # ── 2. Проверить REVIEW.md (ревью от Perplexity) ──────────
    REVIEW=$(git show origin/main:_agents/pipeline/REVIEW.md 2>/dev/null)
    R_PHASE=$(echo "$REVIEW" | sed -n 's/.*phase: \([A-Z_]*\).*/\1/p')
    R_ROUND=$(echo "$REVIEW" | sed -n 's/.*round: \([0-9]*\).*/\1/p')
    R_SAVED=$(cat "$STATE_REV" 2>/dev/null)
    R_NEW="REVIEW:${R_PHASE}:${R_ROUND}"

    if [ "$R_NEW" != "$R_SAVED" ]; then
        echo "$R_NEW" > "$STATE_REV"
        VERDICT=$(echo "$REVIEW" | grep -o 'ВЕРДИКТ: [A-Z_]*' | head -1 | sed 's/ВЕРДИКТ: //')

        if echo "$VERDICT" | grep -q "CHANGES_NEEDED\|CODE_CHANGES_NEEDED"; then
            echo "[$(date)] 🔨 Ревью $R_PHASE round $R_ROUND — $VERDICT, исправляю" >> "$LOG"

            claude --dangerously-skip-permissions -p \
                "Ты — автономный агент Invoice Tracker. Рабочая директория: $PROJECT
Прочитай _agents/pipeline/REVIEW.md из origin/main. Вердикт: $VERDICT.
Прочитай замечания, исправь код, обнови SOLUTION.md (увеличь ROUND на 1, добавь секцию REVISION NOTES).
Запуши исправления. Язык: русский." \
                --max-turns 30 >> "$LOG" 2>&1

            echo "[$(date)] ✅ Исправления по ревью запушены" >> "$LOG"
        else
            echo "[$(date)] 📋 Ревью $R_PHASE round $R_ROUND — $VERDICT" >> "$LOG"
        fi
    fi

    sleep 30
done
