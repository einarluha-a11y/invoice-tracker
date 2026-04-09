# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: IMAP crash loop — too-many-connections — ВЫПОЛНЕНО

## ПРИЧИНА

- `invoice-imap`: 632 рестарта. "Too many simultaneous connections" + "Download was rate limited"
- Корень 1: `rateLimitUntil` Map in-memory → сбрасывался при PM2 restart → daemon сразу снова пытался подключиться
- Корень 2: "Too many connections" не попадал в rate-limit ветку → бан не ставился → каждые 2 мин новая попытка

## ИСПРАВЛЕНИЕ

`automation/imap_listener.cjs`:
1. Rate limits персистированы (выживают restart)
2. "Too many connections" → немедленный throw без retry + 2h бан
3. "Rate limited" → 17h бан (default)
4. Ban timer показывает минуты если <1h осталось

## КОММИТЫ

- `95b32c2` — persist rate limits (Firestore)
- `68b7630` — stop crash loop on too-many-connections
- `5530272` — fix ban timer display (minutes when <1h)

## REVIEW ROUND 2

ВЕРДИКТ: ПРИНЯТО. Crash loop устранён. DEPLOY_STATUS: OK. Ожидаю новых задач от Einar.
