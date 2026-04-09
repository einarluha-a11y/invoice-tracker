# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: IMAP crash loop — rate limits persist в Firestore — ВЫПОЛНЕНО И ПРИНЯТО

## РЕЗУЛЬТАТ

REVIEW ROUND 2 ПРИНЯТО Perplexity.

Решение точно диагностировало корень проблемы (in-memory rate limits сбрасывались при рестарте PM2/Railway) и реализовало персистентные баны в Firestore. DEPLOY_STATUS: OK + 0 крашей подтверждают эффективность.

## ИСПРАВЛЕНИЕ

`automation/imap_listener.cjs`:
- Rate limits теперь сохраняются в Firestore `config/imap_rate_limits` (выживают Railway container restarts)
- "Too many connections" → ban 5 минут (не 2 часа)
- Skip-сообщение показывает минуты для коротких банов

`automation/imap_daemon.cjs`:
- Добавлен `await loadRateLimitsFromFirestore()` ПЕРЕД стартом pollLoop()
- Бан загружается из Firestore на каждом старте → первый poll сразу пропускает забаненный аккаунт

## КОММИТЫ

- `95b32c2` — Firestore persist в imap_listener.cjs
- `8e7d422` — await loadRateLimitsFromFirestore() в imap_daemon.cjs перед pollLoop
- `5530272` — ban timer: показывает минуты когда <1ч (UX fix)
