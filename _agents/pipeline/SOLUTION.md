# SOLUTION

<<<<<<< Updated upstream
<<<<<<< Updated upstream
PHASE: BUGFIX
ROUND: 1
DEPLOY_STATUS: OK
TASK: IMAP crash loop — too-many-connections

## ПРИЧИНА

Два бага в `automation/imap_listener.cjs`:

1. **Inner retry loop** (строка ~90): при ошибке "Too many simultaneous connections" паттерн `too many` попадал в retry-ветку → 3 попытки с ожиданием 60+120s. Каждая попытка открывала новый сокет, усугубляя ситуацию на сервере.

2. **Outer catch** (строка ~517): паттерн `/rate.limit|Download was rate limited|try again in/i` не включал "too many" → бан НЕ ставился → каждые 2 минуты daemon снова пытался подключиться → накопилось 632 рестартов PM2.

## ИСПРАВЛЕНИЕ

- `isTooManyConns` проверка в inner loop: при "too many connections" сразу `throw` без retry
- Outer catch pattern расширен: добавлен `|too many`
- Ban duration: 2h для "too many" (был: 0), 17h default для других
- `_saveRateLimits()` уже вызывался в обоих местах (не было багом)

## КОММИТ

`68b7630` — fix(imap): stop crash loop on too-many-connections
=======
PHASE: WAITING
ROUND: 0
TASK: все задачи из BACKLOG выполнены — ожидаю новых
>>>>>>> Stashed changes
=======
PHASE: WAITING
ROUND: 0
TASK: все задачи из BACKLOG выполнены — ожидаю новых
>>>>>>> Stashed changes
