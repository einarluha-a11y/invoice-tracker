# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: Watchdog автоматический баг-репорт

## ЧТО БЫЛО ИСПРАВЛЕНО

**Причина ложных "Not found and failed to start":**

1. `pm2 start ecosystem.config.cjs --only <name>` для тяжёлых процессов занимает 17-22 секунды. Watchdog использовал timeout: 15000ms → таймаут → ложная ошибка (процесс при этом всё равно стартовал).

2. pipeline-monitor рестартился каждые 10 минут ("hung" detection) потому что в тихий период не логирует ничего → lastLog не меняется → watchdog думает завис.

**Исправления:**
- `automation/watchdog.cjs`: timeout 15000→45000, после таймаута проверить pm2 jlist
- `automation/pipeline_monitor.cjs`: heartbeat log каждые 5 минут (`💓 idle`)

## ВЕРИФИКАЦИЯ

- node --check → OK оба файла
- Коммит: 161bded — pushed to main

DEPLOY_STATUS: OK
