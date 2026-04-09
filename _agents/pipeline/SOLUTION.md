# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: audit-paid + IMAP crash loop — ВЫПОЛНЕНО

## РЕЗУЛЬТАТ АУДИТА (audit-paid)

`node repairman_agent.cjs --audit-paid --fix`

- **Checked**: 142 инвойса со статусом Paid
- **OK**: 52 — корректно совпадают (ref + vendor)
- **Reverted**: 22 — ложные совпадения, возвращены в прежний статус
- **No bank link**: 68 — Paid без банковской привязки (ручные оплаты)

## BUGFIX: IMAP crash loop

`automation/imap_listener.cjs`:
- "Too many connections" → ban 5 минут (не 2 часа)
- `isTooManyConns` выведен отдельно от `isRateLimit` в outer catch
- Skip-сообщение показывает минуты для коротких банов
- В retry-loop: "too many connections" → немедленный throw
- Ban timer: показывает минуты когда <1ч

`automation/imap_daemon.cjs`:
- `await loadRateLimitsFromFirestore()` ПЕРЕД стартом pollLoop()
- Rate limits персистированы в Firestore — выживают Railway container restarts

## КОММИТЫ

- `41b73d0` — fix: "Too many connections" ban 5min instead of 2h, no retry
- `95b32c2` — Firestore persist в imap_listener.cjs
- `8e7d422` — await loadRateLimitsFromFirestore() в imap_daemon.cjs перед pollLoop
- `489b6a4` — audit: --audit-paid --fix (22 reverted, 68 no-bank-link)
- `5530272` — ban timer: показывает минуты когда <1ч
