# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-09 (обновлено 2026-04-09 19:40 UTC — Claude agent sync)
**Ветка:** main
**DEPLOY_STATUS:** OK
**PHASE:** WAITING
**LAST_TASK:** BUGFIX — crash loop imap_daemon (.catch() fix) — задеплоено, BACKLOG исчерпан

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-09 23:00 UTC)

### BUGFIX (imap_daemon — crash loop 685 рестартов)
- `.catch()` добавлен между `checkAndRunFlagTasks()` и `.then()` ✅
- `pollLoop`/`auditLoop` теперь запускаются всегда, даже при ошибке flag tasks ✅
- node --check: OK ✅
- commit: c4bfc34, DEPLOY_STATUS: OK ✅

### CLEANUP (merge conflicts)
- Устранены merge conflicts в SOLUTION.md ✅
- Устранены merge conflicts в REVIEW.md ✅
- ROUND: 0, PHASE: WAITING, DEPLOY_STATUS: OK ✅

### BUGFIX ROUND 2 (imap_listener — "Too many connections")
- "Too many connections" → ban 5 минут (не 2 часа) ✅
- `isTooManyConns` выведен отдельно от `isRateLimit` ✅
- retry-loop: немедленный throw вместо ожидания 60+120с ✅
- commit: 41b73d0, ПРИНЯТО Perplexity

### BUGFIX ROUND 1 (imap_listener + imap_daemon — rate-limit Firestore persist)
- Rate limits → Firestore `config/imap_rate_limits` (выживают Railway рестарты) ✅
- `loadRateLimitsFromFirestore()` перед pollLoop() ✅
- 632 рестарта → 0 крашей ✅
- commits: 95b32c2, 8e7d422, ПРИНЯТО Perplexity

### АУДИТ (audit-paid)
- Checked: 142 инвойса, OK: 52, Reverted: 22, No bank link: 68 ✅
- commit: 489b6a4, ПРИНЯТО Perplexity

## История ревью

| Round | Статус | Комментарий |
|-------|--------|-------------|
| WAITING ROUND 0 (финал) | ПРИНЯТО | Merge conflicts устранены, файлы очищены |
| WAITING ROUND 2 | ИЗМЕНЕНИЯ_НУЖНЫ | Merge conflicts в SOLUTION.md/REVIEW.md |
| WAITING ROUND 1 | ПРИНЯТО | "Too many connections" ban 5min, no retry — корректно |
| WAITING ROUND 0 | ПРИНЯТО | Firestore persist для rate limits — выживает Railway рестарты |
| BUGFIX ROUND 1 | ПРИНЯТО | IMAP rate-limit crash loop устранён (632→0 рестартов) |

## Известные проблемы

### Perplexity pipeline (2026-04-09)
REVIEW.md содержит ответ где Perplexity отказался выступать ревьюером — ответил как обычный поисковый ассистент. GitHub Actions workflow отправил задание в неправильном контексте. Pipeline временно не работает для автоматических ревью. Ручной надзор от Einar.

## Следующий шаг

BACKLOG исчерпан. Ожидаем новых задач от Einar. Система в стабильном состоянии.
