# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-10 (обновлено 2026-04-10 UTC — Claude agent sync v5)
**Ветка:** main
**DEPLOY_STATUS:** OK
**PHASE:** WAITING
**LAST_TASK:** BUGFIX ROUND 2 (watchdog false alarm) — ПРИНЯТО Perplexity. BACKLOG исчерпан.

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-10 UTC)

### BUGFIX ROUND 1 — Watchdog ложный crash loop репорт (ПРИНЯТО)
- `console.warn()` пишет в stderr → watchdog читает и получает обрезанное "estore on startup." — не ошибка ✅
- Реальные фиксы crash loop: коммиты `3f90b55` (unhandledRejection unsafe cast) + `8af1cd3` (Firestore batch "Transaction too big") ✅
- Watchdog поймал "хвост" старого crash loop через 17с после фикса — Railway ещё не задеплоил ✅
- Текущее состояние: 0 новых крашей, imap запущен нормально ✅
- Perplexity ВЕРДИКТ: ПРИНЯТО

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
| BUGFIX ROUND 2 (watchdog false alarm) | ПРИНЯТО | Полный анализ хронологии, первопричины и ложной тревоги подтверждён |
| BUGFIX ROUND 1 (watchdog false alarm) | ПРИНЯТО | Ложный репорт из console.warn→stderr, реальные фиксы 3f90b55+8af1cd3 |
| WAITING ROUND 0 (финал) | ПРИНЯТО | Merge conflicts устранены, файлы очищены |
| WAITING ROUND 2 | ИЗМЕНЕНИЯ_НУЖНЫ | Merge conflicts в SOLUTION.md/REVIEW.md |
| WAITING ROUND 1 | ПРИНЯТО | "Too many connections" ban 5min, no retry — корректно |
| WAITING ROUND 0 | ПРИНЯТО | Firestore persist для rate limits — выживает Railway рестарты |
| BUGFIX ROUND 1 | ПРИНЯТО | IMAP rate-limit crash loop устранён (632→0 рестартов) |
| WAITING ROUND 1 | ПРИНЯТО | rateLimitUntil персистентность через .rate_limits.json — crash loop невозможен |
| WAITING ROUND 1 (триггер) | ПРИНЯТО | STATUS.md обновлён, DEPLOY_STATUS: OK, ждём следующего задания |
| WAITING ROUND 2 | ПРИНЯТО | .rate_limits.json персистентность подтверждена, crash loop невозможен |
| WAITING ROUND 1 (финал) | ПРИНЯТО | Perplexity подтвердил: in-memory→JSON персистентность и таймауты корректны. Ждём новых задач. |
| WAITING ROUND 2 (финал) | ПРИНЯТО | Firestore persist для rate limits — выживает Railway рестарты. 0 крашей. Ждём новых задач. |

## Известные проблемы

### Perplexity pipeline (2026-04-09)
REVIEW.md содержит ответ где Perplexity отказался выступать ревьюером — ответил как обычный поисковый ассистент. GitHub Actions workflow отправил задание в неправильном контексте. Pipeline временно не работает для автоматических ревью. Ручной надзор от Einar.

## Следующий шаг

BACKLOG исчерпан. Ожидаем новых задач от Einar. Система в стабильном состоянии.

### AGENT_SYNC 2026-04-10 UTC (sync v4)
- REVIEW: ПРИНЯТО (watchdog false alarm root cause analysis)
- PHASE: WAITING, DEPLOY_STATUS: OK
- Все процессы PM2: online ✅
- Новых задач нет. Система стабильна. Ожидание.
