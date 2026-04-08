# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-20 — Заменить polling на GitHub Webhook (мгновенная надёжная связь)

## ВЫПОЛНЕНО

### ✅ 1. automation/webhook_receiver.cjs — создан
Express-сервер на порту 3001. Верифицирует подпись GitHub (HMAC-SHA256).
При изменении `_agents/pipeline/SOLUTION.md` — запускает Claude CLI в detached-процессе.
GET /health — живой check.

### ✅ 2. ecosystem.config.cjs — добавлен pipeline-webhook
```js
{
  name: 'pipeline-webhook',
  script: './automation/webhook_receiver.cjs',
  restart_delay: 3000,
  max_restarts: 10,
  max_memory_restart: '200M',
  env: { WEBHOOK_PORT: 3001 }
}
```
`pipeline-monitor` оставлен как fallback до завершения настройки webhook.

### ⏳ 3. Cloudflare Tunnel — требует ручного запуска
```bash
brew install cloudflared   # если нет
cloudflared tunnel --url http://localhost:3001
```
Скопировать URL (вида `https://xxxx.trycloudflare.com`) → записать в `_agents/pipeline/WEBHOOK_URL.md`.

### ⏳ 4. GitHub Webhook — требует настройки в браузере
1. https://github.com/einarluha-a11y/invoice-tracker/settings/hooks/new
2. Payload URL: `<URL из шага 3>/pipeline`
3. Content type: `application/json`
4. Secret: `openssl rand -hex 20` → сохранить в `.env.pipeline` как `WEBHOOK_SECRET`
5. Events: **Just the push event** → Add webhook

### ⏳ 5. После успешного теста
```bash
pm2 delete pipeline-monitor
```

## Верификация кода
- `node --check automation/webhook_receiver.cjs`: OK
- `node --check ecosystem.config.cjs`: OK

DEPLOY_STATUS: OK
