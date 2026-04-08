/**
 * webhook_receiver.cjs — GitHub Webhook listener for pipeline triggers
 * Replaces polling (pipeline_monitor.cjs) with instant push-event delivery.
 *
 * Setup:
 *   1. Start: pm2 start ecosystem.config.cjs --only pipeline-webhook
 *   2. Expose via Cloudflare Tunnel: cloudflared tunnel --url http://localhost:3001
 *   3. Register URL + secret at github.com/.../settings/hooks
 */

"use strict";

const express = require("express");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.post("/pipeline", (req, res) => {
  // Verify GitHub signature
  const sig = req.headers["x-hub-signature-256"];
  const secret = process.env.WEBHOOK_SECRET || "";

  if (!sig || !secret) {
    return res.status(401).json({ error: "Missing signature or secret" });
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

  if (sig !== expected) {
    console.warn("[webhook] Invalid signature, rejecting request");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const changedFiles = (req.body.commits || []).flatMap((c) => [
    ...(c.added || []),
    ...(c.modified || []),
  ]);

  if (!changedFiles.includes("_agents/pipeline/SOLUTION.md")) {
    return res.status(200).json({ skip: true, reason: "SOLUTION.md not changed" });
  }

  res.status(200).json({ ok: true, triggered: true });

  // Trigger Claude CLI asynchronously — detached so it outlives this process
  const projectDir = process.env.PROJECT_DIR || process.cwd();
  const agentPrompt =
    "Ты — автономный агент Invoice Tracker. " +
    `Рабочая директория: ${projectDir}. ` +
    "Прочитай _agents/pipeline/SOLUTION.md из origin/main " +
    "(git show origin/main:_agents/pipeline/SOLUTION.md). " +
    "Выполни задание. Соблюдай протоколы из CLAUDE.md. " +
    "После: node --check, DEPLOY_STATUS: OK в SOLUTION.md, коммит, пуш. Русский, коротко.";

  const proc = spawn(
    "claude",
    ["--print", "--dangerously-skip-permissions", agentPrompt],
    {
      detached: true,
      stdio: "ignore",
      cwd: projectDir,
    }
  );
  proc.unref();

  console.log("[webhook] Claude CLI triggered at", new Date().toISOString());
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = parseInt(process.env.WEBHOOK_PORT || "3001", 10);
app.listen(PORT, () =>
  console.log(`[webhook] Listening on port ${PORT}`)
);
