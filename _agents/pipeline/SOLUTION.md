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

## DEPLOY_STATUS: OK

## Выполнено
- automation/webhook_receiver.cjs создан (Express, HMAC-256 верификация, spawn Claude CLI)
- ecosystem.config.cjs обновлён: pipeline-webhook процесс с WEBHOOK_SECRET, PROJECT_DIR
- PM2 pipeline-webhook: online на порту 3001
- Cloudflare Quick Tunnel: https://weeks-slots-gently-likewise.trycloudflare.com
- WEBHOOK_URL.md создан
- GitHub webhook ID 605082436 зарегистрирован на einarluha-a11y/invoice-tracker
- /health endpoint: {"ok":true} ✓
