# SOLUTION

PHASE: WAITING
ROUND: 1
DEPLOY_STATUS: OK
TASK: IMAP crash loop — rate limited — ВЫПОЛНЕНО

## ПРИЧИНА

- `invoice-imap`: 632 рестарта. Ошибка: `Download was rate limited. Try again in 15 hours`
- Корень 1: `rateLimitUntil` Map in-memory → при рестарте PM2 сбрасывался → сразу снова пытался IMAP → rate limited снова
- Корень 2: Local file `.rate_limits.json` ephemeral на Railway — уничтожался при каждом рестарте контейнера

## ИСПРАВЛЕНИЕ

`automation/imap_listener.cjs`:
- Rate limits теперь сохраняются в Firestore `config/imap_rate_limits` (выживают Railway container restarts)
- Вызов в обоих местах: event handler + outer catch

`automation/imap_daemon.cjs`:
- Добавлен `await loadRateLimitsFromFirestore()` ПЕРЕД стартом pollLoop()
- Бан загружается из Firestore на каждом старте → первый poll сразу пропускает забаненный аккаунт

## КОММИТЫ

- `95b32c2` — Firestore persist в imap_listener.cjs
- `8e7d422` — await loadRateLimitsFromFirestore() в imap_daemon.cjs перед pollLoop
