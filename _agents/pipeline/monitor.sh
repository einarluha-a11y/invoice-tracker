#!/bin/bash
# Тихий мониторинг REVIEW.md — проверяет каждые 30 сек
# Если phase:round изменился — выводит уведомление

STATE_FILE="/tmp/.pipeline_state"

# Инициализация
if [ ! -f "$STATE_FILE" ]; then
    git fetch origin main --quiet 2>/dev/null
    REVIEW=$(git show origin/main:_agents/pipeline/REVIEW.md 2>/dev/null)
    PHASE=$(echo "$REVIEW" | sed -n 's/.*phase: \([A-Z_]*\).*/\1/p')
    ROUND=$(echo "$REVIEW" | sed -n 's/.*round: \([0-9]*\).*/\1/p')
    echo "${PHASE}:${ROUND}" > "$STATE_FILE"
    echo "🔧 Инициализация: ${PHASE}:${ROUND}"
fi

while true; do
    git fetch origin main --quiet 2>/dev/null
    REVIEW=$(git show origin/main:_agents/pipeline/REVIEW.md 2>/dev/null)

    PHASE=$(echo "$REVIEW" | sed -n 's/.*phase: \([A-Z_]*\).*/\1/p')
    ROUND=$(echo "$REVIEW" | sed -n 's/.*round: \([0-9]*\).*/\1/p')
    CURRENT=$(cat "$STATE_FILE" 2>/dev/null)
    NEW="${PHASE}:${ROUND}"

    if [ "$NEW" != "$CURRENT" ]; then
        echo "$NEW" > "$STATE_FILE"
        VERDICT=$(echo "$REVIEW" | grep -o 'ВЕРДИКТ: [A-Z_]*' | head -1 | sed 's/ВЕРДИКТ: //')
        echo ""
        echo "📋 Новый ревью: ${PHASE} round ${ROUND} — ${VERDICT}"
        echo "---"
        echo "$REVIEW"
        echo "---"
    fi

    sleep 30
done
