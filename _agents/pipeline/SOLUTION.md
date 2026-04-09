# SOLUTION

PHASE: WAITING
ROUND: 0
DEPLOY_STATUS: OK
TASK: все задачи выполнены — ожидаю новых от Einar/Perplexity

## ПОСЛЕДНЕЕ ЗАВЕРШЁННОЕ

IMAP crash loop + audit-paid — ВЫПОЛНЕНО (REVIEW ПРИНЯТО)

### audit-paid результат
`node repairman_agent.cjs --audit-paid --fix`
- Checked: 142 инвойса со статусом Paid
- OK: 52 — корректно совпадают
- Reverted: 22 — ложные совпадения, возвращены
- No bank link: 68 — Paid без банковской привязки

### IMAP crash loop fix (`automation/imap_listener.cjs`)
- "Too many connections" → бан 5 минут (не 2 часа)
- `isTooManyConns` выведен отдельно от `isRateLimit`
- В retry-loop: "too many connections" → немедленный throw

### Rate limits persist (`automation/imap_daemon.cjs`)
- `await loadRateLimitsFromFirestore()` перед pollLoop
- Выживают Railway container restarts

### Коммиты
- `41b73d0` — fix: "Too many connections" ban 5min instead of 2h, no retry
- `95b32c2` — Firestore persist в imap_listener.cjs
- `8e7d422` — await loadRateLimitsFromFirestore() в imap_daemon.cjs перед pollLoop
- `489b6a4` — audit: --audit-paid --fix (22 reverted, 68 no-bank-link)
