# SOLUTION

PHASE: WAITING
ROUND: 3
DEPLOY_STATUS: OK
TASK: IMAP crash loop полностью устранён — Firestore persist + watchdog delta — ВЫПОЛНЕНО

## ИСПРАВЛЕНИЯ

### imap_listener.cjs
- "Too many connections" → ban 5 минут (не 2 часа)
- Rate limits персистированы в Firestore (config/imap_rate_limits) — выживают Railway container restarts
- loadRateLimitsFromFirestore() экспортирована и вызывается при загрузке модуля

### imap_daemon.cjs
- await loadRateLimitsFromFirestore() ПЕРЕД стартом pollLoop()

### watchdog.cjs
- Delta-check вместо абсолютного порога — тревога только при >=3 новых рестартах за цикл
- Первый запуск: seed с текущим счётчиком (исключает ложные алерты от старых 632 рестартов)

## КОММИТЫ

- 41b73d0 — fix: "Too many connections" ban 5min, no retry
- 95b32c2 — Firestore persist в imap_listener.cjs
- 8e7d422 — await loadRateLimitsFromFirestore() в imap_daemon.cjs
- 52efca0 — module-level load + watchdog delta check
