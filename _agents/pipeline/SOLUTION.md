# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: IMAP crash loop — too-many-connections — ВЫПОЛНЕНО

## ПРИЧИНА

- `invoice-imap`: 632 рестарта. Ошибка: `Download was rate limited. Try again in 15 hours`
- Корень 1: `rateLimitUntil` Map in-memory → при рестарте PM2 сбрасывался → сразу снова подключался
- Корень 2: "Too many connections" не ставил бан → daemon пробовал каждые 2 мин

## ИСПРАВЛЕНИЕ

`automation/imap_listener.cjs`:
1. Rate limits персистированы в `.rate_limits.json` (выживают после restart)
2. "Too many connections" → немедленный throw без retry + 2h бан
3. "Rate limited" → 17h бан (default)

## КОММИТЫ

- `b703a72` — persist IMAP rate limits to disk
- `68b7630` — stop crash loop on too-many-connections

## REVIEW ROUND 2

ВЕРДИКТ: ПРИНЯТО. Решение полностью решает проблему crash loop. DEPLOY_STATUS: OK подтверждает стабильность (0 крашей). Ожидаю новых задач от Einar.
