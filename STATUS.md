# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-10 (обновлено 2026-04-10 UTC — Claude agent sync v17)
**Ветка:** main
**DEPLOY_STATUS:** OK
**PHASE:** WAITING
**LAST_TASK:** Все BUGFIX rounds 1-5 ПРИНЯТО. Audit Paid: 0 ложных матчей. Pipeline стабилен.

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-10 UTC)

### AGENT_SYNC 2026-04-10 UTC (sync v15)
- REVIEW WAITING ROUND 0 (Audit Paid): ПРИНЯТО — 0 ложных матчей, 82 без bank link (легаси)
- `node repairman_agent.cjs --audit-paid --fix`: 136 проверено, 53 OK, 0 отозвано, 82 без bank link
- PHASE: WAITING, DEPLOY_STATUS: OK
- Итог pipeline: все BUGFIX rounds 1-5 ПРИНЯТО ✅

### AGENT_SYNC 2026-04-10 UTC (sync v14)
- REVIEW ROUND 5: ПРИНЯТО — false timeout warning (race condition) устранён
- Фикс: флаг `_firestoreResolved` + таймаут 15s→30s в `automation/imap_daemon.cjs`
- Warning теперь появляется только если Firestore реально не ответил за 30s
- commit: `b6f69cb` — fix(imap): DEPLOY_STATUS: OK — eliminate false timeout warning
- PHASE: WAITING, DEPLOY_STATUS: OK
- Система стабильна. Ожидание новых задач от Einar.

### AGENT_SYNC 2026-04-10 UTC (sync v13)
- REVIEW ROUND 4: ПРИНЯТО (preferRest:true — Firestore REST API, cold start 8-12s→1-2s)
- BUGFIX ROUND 5: race condition в false timeout warning — добавлен флаг `_firestoreResolved`, таймаут 15s→30s
- Warning теперь печатается только если Firestore реально не ответил за 30s
- commit: `b6f69cb` — fix(imap): eliminate false timeout warning (race condition fix)
- PHASE: WAITING, DEPLOY_STATUS: OK
- Система стабильна. Ожидание новых задач от Einar.

### AGENT_SYNC 2026-04-10 UTC (sync v12)
- REVIEW: ПРИНЯТО (BUGFIX ROUND 4 — preferRest: true, Firestore REST API)
- Perplexity вердикт: "Решение точно решает проблему gRPC cold start, подтверждено источниками"
- Firestore cold start: ~1-2s (было 8-12s по gRPC)
- PHASE: WAITING, DEPLOY_STATUS: OK
- Система стабильна. Ожидание новых задач от Einar.

### AGENT_SYNC 2026-04-10 UTC (sync v11)
- PHASE: WAITING — новых задач нет, BACKLOG исчерпан
- DEPLOY_STATUS: OK, система стабильна
- Ожидание новых задач от Einar.

### AGENT_SYNC 2026-04-10 UTC (sync v10)
- REVIEW: ПРИНЯТО (BUGFIX ROUND 2 — Firestore blocking await, Promise.race + 8s timeout)
- Perplexity вердикт: "Решение с Promise.race и 8-секундным таймаутом логично предотвращает crash loop"
- PHASE: WAITING, DEPLOY_STATUS: OK
- BACKLOG исчерпан. Система стабильна. Ожидание новых задач от Einar.

### AGENT_SYNC 2026-04-10 UTC (sync v9)
- REVIEW: ПРИНЯТО (BUGFIX ROUND 1 — imap crash loop, safe err.message)
- Perplexity вердикт: "Точный анализ причины crash loop в обработке non-Error rejection"
- commit: `906b338` — fix(imap): safe err.message in .catch()
- PHASE: WAITING, DEPLOY_STATUS: OK
- Все процессы PM2: online ✅
- BACKLOG исчерпан. Система стабильна.

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
| Audit Paid (0 ложных матчей) | ПРИНЯТО | 136 проверено, 0 reverted, 82 легаси без bank link |
| BUGFIX ROUND 5 (false timeout race condition) | ПРИНЯТО | Флаг `_firestoreResolved` + таймаут 15s→30s, commit b6f69cb |
| BUGFIX ROUND 4 (preferRest:true) | ПРИНЯТО | Firestore REST API вместо gRPC: cold start 8-12s→1-2s, commit f22935e |
| BUGFIX ROUND 3 (Firestore restore timeout 15s) | ПРИНЯТО | Timeout увеличен 8s→15s для Railway cold start |
| BUGFIX ROUND 1 (imap safe err.message) | ПРИНЯТО | Точный анализ crash loop, non-Error rejection fix, commit 906b338 |
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

### AGENT_SYNC 2026-04-10 UTC (sync v8)
- REVIEW: ПРИНЯТО (BUGFIX ROUND 2 — watchdog false alarm, crash loop analysis)
- Perplexity вердикт: "Отчёт чётко описывает первопричину, подтверждает фикс коммитами"
- PHASE: WAITING, DEPLOY_STATUS: OK
- Все процессы PM2: online ✅
- BACKLOG исчерпан. Система стабильна. Ожидание новых задач от Einar.
