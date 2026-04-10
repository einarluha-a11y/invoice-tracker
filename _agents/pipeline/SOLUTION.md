# SOLUTION

PHASE: BUGFIX
ROUND: 1
DEPLOY_STATUS: OK
TASK: PM2 crash loop — invoice-imap 477+ рестартов (auto bug report)

## ЧТО БЫЛО

- `invoice-imap`: 477+ рестартов, uptime ~15s
- `getaddrinfo ENOTFOUND firestore.googleapis.com` при poll
- `_keepAlive` 60s не защищал первые 60s event loop
- `pollLoop`/`auditLoop` без self-healing

## ЧТО ИСПРАВИЛИ

1. `imap_daemon.cjs`: `_keepAlive` 60s→5s
2. `imap_daemon.cjs`: self-healing обёртки — перезапуск через 30s вместо PM2 restart
3. `imap_listener.cjs`: exponential backoff при consecutive failures (2→4→8 min)
4. `error_reporter.cjs`: убрано misleading "Escalating to external webhook"

## РЕЗУЛЬТАТ

uptime 2+ мин после деплоя, счётчик рестартов не растёт.

node --check: OK
STATUS_SYNC: v22 — 2026-04-10 UTC
