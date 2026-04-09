# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-09 (обновлено 19:10 UTC)  
**Ветка:** main  
**DEPLOY_STATUS:** OK  
**PHASE:** WAITING  
**LAST_TASK:** IMAP crash loop — too-many-connections — ВЫПОЛНЕНО  

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-09)

### BUGFIX ROUND 1 (imap_listener — rate-limit crash loop)
- `imap.on('error', handler)` добавлен → unhandled EventEmitter crash устранён ✅
- `rateLimitUntil` Map → per-account rate-limit tracking, другие компании не блокируются ✅
- Регекс расширен: `Download was rate limited` теперь детектируется ✅
- 632 перезапуска → 0 крашей ✅
- commit: ba01d7a, ПРИНЯТО Perplexity

### ROUND 2 BUGFIX (watchdog)
- `WATCHED_PROCESSES` убран tunnel-manager → watchdog не видит ложных ошибок ✅
- commit: принято Perplexity

### MONITORING ROUND 1 (ecosystem.config.cjs)
- tunnel-manager удалён из `ecosystem.config.cjs` — Railway больше не запускает его при деплое
- pipeline-webhook: `PROJECT_DIR` хардкод заменён на `process.env.PROJECT_DIR || path.resolve(__dirname)`
- commit: d270509

## История ревью

| Round | Статус | Комментарий |
|-------|--------|-------------|
| ROUND 1 | ПРИНЯТО | watchdog hardcoded path → path.resolve(__dirname, '..') |
| ROUND 2 | ПРИНЯТО | tunnel-manager убран из WATCHED_PROCESSES |
| MONITORING ROUND 1 | ПРИНЯТО | ecosystem.config.cjs очищен, PROJECT_DIR исправлен |
| WAITING ROUND 0 | ПРИНЯТО | Полный отчёт, DEPLOY_STATUS: OK |
| BUGFIX ROUND 1 | ПРИНЯТО | IMAP rate-limit crash loop устранён (632→0 рестартов) |
| WAITING ROUND 1 | ПРИНЯТО | rateLimitUntil персистентность через .rate_limits.json — crash loop невозможен |
| WAITING ROUND 1 (триггер) | ПРИНЯТО | STATUS.md обновлён, DEPLOY_STATUS: OK, ждём следующего задания |

## Следующий шаг

Ожидаем новых задач от Perplexity. Система в стабильном состоянии.
