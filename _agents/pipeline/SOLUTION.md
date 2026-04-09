# SOLUTION

PHASE: WAITING
ROUND: 1
DEPLOY_STATUS: OK
TASK: IMAP crash loop — "Too many simultaneous connections" — ВЫПОЛНЕНО

## ПРИЧИНА

- `invoice-imap`: Crash loop с "Too many simultaneous connections"
- Корень 1: При PM2-рестарте IMAP-соединение оставалось открытым на сервере → новый процесс не мог подключиться
- Корень 2: "Too many connections" ставил бан на 2 ЧАСА → аккаунты не опрашивались до следующего утра
- Корень 3: Retry-логика не отличала "too many" от rate limit → делала лишние попытки

## ИСПРАВЛЕНИЕ

`automation/imap_listener.cjs`:
- "Too many connections" → ban 5 минут (не 2 часа) — сервер освобождает соединение быстро
- `isTooManyConns` выведен отдельно от `isRateLimit` в outer catch
- Skip-сообщение показывает минуты для коротких банов (не часы)
- В retry-loop: "too many connections" → немедленный throw (не ждёт 60+120с)
- Rate limits персистированы в Firestore — выживают Railway container restarts

## АУДИТ ДАННЫХ

`node repairman_agent.cjs --audit-paid --fix`: 22 ложных совпадений отменены, 68 Paid без банк. ссылки (исторические, ОК).

## КОММИТЫ

- `b703a72` — persist IMAP rate limits to disk
- `68b7630` — fix crash loop on too-many-connections
- `41b73d0` — ban 5min (not 2h), no retry on too-many-conn
