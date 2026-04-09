# SOLUTION

PHASE: WAITING
<<<<<<< Updated upstream
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

## ПРЕДЫДУЩИЕ КОММИТЫ (контекст)

<<<<<<< Updated upstream
## КОММИТЫ

- `95b32c2` — Firestore persist в imap_listener.cjs
- `8e7d422` — await loadRateLimitsFromFirestore() в imap_daemon.cjs перед pollLoop
=======
ROUND: 0
TASK: все задачи из BACKLOG выполнены — ожидаю новых
>>>>>>> Stashed changes
=======
- `95b32c2` — Firestore persist rate limits (выживают Railway restarts)
- `8e7d422` — await loadRateLimitsFromFirestore() перед pollLoop
>>>>>>> Stashed changes
