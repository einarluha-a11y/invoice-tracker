# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: watchdog — tunnel-manager crash loop → ложные bug reports каждые 10 мин

## ПРОБЛЕМА

1. `WATCHED_PROCESSES` включал `tunnel-manager` — на Railway нет `cloudflared`, процесс постоянно крашил (820 рестартов).
2. Watchdog видел >50 рестартов → каждые 10 мин пытался писать bug report в SOLUTION.md.
3. В предыдущем раунде путь `PROJECT` уже исправлен на `path.resolve(__dirname, '..')`.

## ИСПРАВЛЕНИЕ

`automation/watchdog.cjs`:
- Убрал `tunnel-manager` из `WATCHED_PROCESSES` — cloudflared только для локальной разработки, на Railway не нужен.

## ПРОВЕРКА

- `node --check automation/watchdog.cjs` → OK
- commit `c929dd1`, push в main

DEPLOY_STATUS: OK
