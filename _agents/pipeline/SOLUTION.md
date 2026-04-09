# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: IMAP rate limit crash loop — УЖЕ ВЫПОЛНЕНО

## ЧТО БЫЛО

- **invoice-imap**: Crash loop: 632 рестартов.
- Причина 1: `rateLimitUntil` — Map в памяти. При рестарте PM2 обнулялась → снова пытался подключиться → rate limit → краш.
- Причина 2: "Too many simultaneous connections" не попадал в rate-limit ветку → бан не ставился → снова краш.

## ЧТО СДЕЛАНО

Файл: `automation/imap_listener.cjs`

1. `isTooManyConns` проверка в inner loop: при "too many connections" сразу `throw` без retry
2. Outer catch pattern расширен: добавлен `|too many`
3. Ban duration: 2h для "too many", 17h default
4. `rateLimitUntil` персистируется в `.rate_limits.json` — выживает после PM2 restart
5. Per-account rate-limit tracking — другие компании не блокируются

## КОММИТЫ

`b703a72` — fix: persist IMAP rate limits to disk — prevent crash loop on PM2 restart
`68b7630` — fix(imap): stop crash loop on too-many-connections

## РЕЗУЛЬТАТ

632 перезапуска → 0 крашей. REVIEW ROUND 2 ПРИНЯТО. Система стабильна. Задача закрыта.

DEPLOY_STATUS: OK
