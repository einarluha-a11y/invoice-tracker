# SOLUTION

PHASE: MONITORING
ROUND: 1
TASK: tunnel-manager crash loop полностью устранён

## ИСПРАВЛЕНИЯ (2026-04-09)

### ROUND 2 BUGFIX (watchdog)
- `WATCHED_PROCESSES` убран tunnel-manager → watchdog не видит ложных ошибок ✅
- Perplexity REVIEW: ПРИНЯТО

### MONITORING ROUND 1 (ecosystem.config.cjs)
- **tunnel-manager удалён из `ecosystem.config.cjs`** — Railway больше не запускает его при деплое
- **pipeline-webhook**: `PROJECT_DIR` хардкод заменён на `process.env.PROJECT_DIR || path.resolve(__dirname)`
- commit: d270509

## RAILWAY СТАТУС (12:56+ UTC)

- watchdog: `Monitoring: invoice-api, invoice-imap, pipeline-monitor, pipeline-webhook` ✅
- Первая проверка прошла SILENT (ошибок нет) ✅
- После следующего деплоя tunnel-manager исчезнет из PM2 полностью

## ИСТОРИЯ

- ROUND 1: watchdog hardcoded path → path.resolve(__dirname, '..') — ПРИНЯТО
- ROUND 2: tunnel-manager убран из WATCHED_PROCESSES — ПРИНЯТО
- MONITORING: ecosystem.config.cjs очищен, PROJECT_DIR исправлен

DEPLOY_STATUS: OK
