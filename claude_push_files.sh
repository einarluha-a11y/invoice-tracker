#!/bin/bash
# Запусти этот скрипт в корне проекта invoice-tracker:
# bash claude_push_files.sh

set -e
set -a; source .env.pipeline; set +a

OWNER="einarluha-a11y"
REPO="invoice-tracker"

push_file() {
  local path="$1"
  local file="$2"
  local msg="$3"
  
  # Получаем SHA если файл уже существует
  SHA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$OWNER/$REPO/contents/$path" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sha',''))" 2>/dev/null || echo "")
  
  CONTENT=$(base64 -i "$file" 2>/dev/null || base64 "$file")
  
  if [ -n "$SHA" ]; then
    BODY="{\"message\":\"$msg\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\"}"
  else
    BODY="{\"message\":\"$msg\",\"content\":\"$CONTENT\"}"
  fi
  
  STATUS=$(curl -s -o /tmp/gh_response.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    "https://api.github.com/repos/$OWNER/$REPO/contents/$path")
  
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "201" ]; then
    echo "✅ Запушен: $path"
  else
    echo "❌ Ошибка $STATUS для $path:"
    cat /tmp/gh_response.json
  fi
}

echo "🚀 Пушу файлы Perplexity Agent в GitHub..."

push_file "perplexity_agent.mjs" "perplexity_agent.mjs" "feat: add perplexity reviewer agent"
push_file "_agents/workflows/pipeline_protocol.md" "pipeline_claude_workflow.md" "feat: add pipeline protocol for Claude"

echo ""
echo "✅ Готово! Теперь запусти агента:"
echo "   ./run_perplexity_agent.sh"
