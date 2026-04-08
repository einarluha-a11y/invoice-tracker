# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-20 — Заменить polling на GitHub Webhook (мгновенная надёжная связь)

## ПОЧЕМУ ЭТО СРОЧНО

Текущий polling каждые 30 сек — главная причина всех проблем:
задания теряются, PM2 зависает, нужно будить вручную.
Webhook решает это раз и навсегда.

## ШАГ 1 — automation/webhook_receiver.cjs

```js
const express = require("express");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.post("/pipeline", (req, res) => {
  // Верифицируем подпись GitHub
  const sig = req.headers["x-hub-signature-256"];
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET || "")
    .update(req.rawBody).digest("hex");

  if (!sig || sig !== expected) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const changedFiles = (req.body.commits || [])
    .flatMap(c => [...(c.added || []), ...(c.modified || [])]);

  if (!changedFiles.includes("_agents/pipeline/SOLUTION.md")) {
    return res.status(200).json({ skip: true });
  }

  res.status(200).json({ ok: true, triggered: true });

  // Запускаем Claude CLI асинхронно
  const proc = spawn("claude", [
    "--print",
    "git pull origin main --quiet && cat _agents/pipeline/SOLUTION.md"
  ], {
    detached: true,
    stdio: "ignore",
    cwd: process.env.PROJECT_DIR || process.cwd()
  });
  proc.unref();

  console.log("[webhook] Claude CLI triggered at", new Date().toISOString());
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.WEBHOOK_PORT || 3001;
app.listen(PORT, () => console.log(`[webhook] Listening on port ${PORT}`));
```

## ШАГ 2 — ecosystem.config.cjs

Добавить новый процесс:
```js
{
  name: "pipeline-webhook",
  script: "./webhook_receiver.cjs",
  env: {
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    PROJECT_DIR: process.env.PROJECT_DIR,
    WEBHOOK_PORT: 3001
  },
  max_restarts: 10,
  restart_delay: 3000
}
```

Также добавить max_restarts и restart_delay для invoice-api и invoice-imap.

## ШАГ 3 — Cloudflare Tunnel

```bash
# Установить если нет:
brew install cloudflared

# Запустить туннель (даёт постоянный URL):
cloudflared tunnel --url http://localhost:3001
```

Скопировать полученный URL (вида https://xxxx.trycloudflare.com).
Записать его в файл `_agents/pipeline/WEBHOOK_URL.md`.

## ШАГ 4 — GitHub Webhook

1. Открыть https://github.com/einarluha-a11y/invoice-tracker/settings/hooks/new
2. Payload URL: <URL из шага 3>/pipeline
3. Content type: application/json
4. Secret: сгенерировать через `openssl rand -hex 20` и сохранить в .env как WEBHOOK_SECRET
5. Events: Just the push event
6. Нажать Add webhook

## ШАГ 5 — Тест

Сделай небольшое изменение в SOLUTION.md и запушь.
В логах pipeline-webhook должно появиться: "[webhook] Claude CLI triggered".

## ШАГ 6 — После успешного теста

Остановить и удалить pipeline_monitor из PM2:
```bash
pm2 delete pipeline-monitor
```

## Верификация финальная
- pm2 status — pipeline-webhook online
- Изменение в SOLUTION.md → Claude CLI запускается < 2 сек
- pm2 logs pipeline-webhook — нет ошибок

