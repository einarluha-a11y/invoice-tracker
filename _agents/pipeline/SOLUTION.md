# SOLUTION

PHASE: CODE
ROUND: 1
TASK: TASK-20 — Заменить polling на GitHub Webhook

## ЗАДАНИЕ

Создать automation/webhook_receiver.cjs (Express на порту 3001):
- POST /pipeline от GitHub
- Верификация X-Hub-Signature-256
- При изменении SOLUTION.md → spawn Claude CLI
- Добавить в ecosystem.config.cjs как PM2 процесс

Настроить Cloudflare Tunnel:
- cloudflared tunnel на localhost:3001
- Записать URL в _agents/pipeline/WEBHOOK_URL.md
- Добавить webhook в GitHub repo settings

## Верификация
- Push в SOLUTION.md → webhook получает → Claude CLI запускается < 5 сек
- pm2 logs pipeline-webhook показывает входящие запросы
