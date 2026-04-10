# SOLUTION

PHASE: WAITING
ROUND: 0
TASK: watchdog baseline fix + startup logs — ожидаю новых задач

## Что сделано
- `watchdog.cjs` — фикс: seed `restartCounts[name]` ДО проверки `errored` статуса. Без этого после recovery накапливался дельта и watchdog ложно репортил crash-loop. Коммит d79034f.
- `imap_daemon.cjs` — добавлены startup stage логи для Railway диагностики.
- Оба файла: `node --check` OK, push OK.

DEPLOY_STATUS: OK
