# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-09 (обновлено 21:45 UTC)  
**Ветка:** main  
**DEPLOY_STATUS:** OK  
**PHASE:** WAITING  
**LAST_TASK:** SOLUTION.md очищен от merge conflicts, pipeline в стабильном состоянии  

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-09)

### CLEANUP: Merge conflicts в SOLUTION.md
- SOLUTION.md содержал вложенные merge conflicts (<<<<<<</>>>>>>>)
- Очищен вручную: PHASE: WAITING, ROUND: 0, TASK: ожидаю новых
- Сохранён полный отчёт о выполненных задачах

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

### АУДИТ PAID (audit-paid --fix)
- 142 инвойса проверено, 22 ложных совпадения откатено ✅
- commit: 489b6a4, ПРИНЯТО Perplexity

## История ревью

| Round | Статус | Комментарий |
|-------|--------|-------------|
| WAITING ROUND 2 (cleanup) | ПРИНЯТО | Merge conflicts в SOLUTION.md устранены |
| WAITING ROUND 2 (финал) | ПРИНЯТО | "Too many connections" ban 5min, no retry — корректно |
| WAITING ROUND 1 | ПРИНЯТО | Firestore persist для rate limits — выживает Railway рестарты |
| BUGFIX ROUND 1 | ПРИНЯТО | IMAP rate-limit crash loop устранён (632→0 рестартов) |

## Следующий шаг

Ожидаем новых задач от Perplexity. Система в стабильном состоянии.
