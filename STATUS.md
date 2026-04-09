# STATUS — Invoice Tracker Pipeline

**Дата:** 2026-04-09  
**Ветка:** main  
**DEPLOY_STATUS:** OK  
**PHASE:** WAITING  

## Текущее состояние системы

Все основные процессы стабильны:
- `invoice-api` — online ✅
- `invoice-imap` — online ✅
- `pipeline-monitor` — online ✅
- `pipeline-webhook` — online ✅
- `watchdog` — online, мониторинг активен ✅

## Последние изменения (2026-04-09)

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

## Следующий шаг

Ожидаем новых задач от Perplexity. Система в стабильном состоянии.
