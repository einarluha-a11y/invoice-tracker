# SOLUTION

PHASE: WAITING
ROUND: 1
TASK: Watchdog автоматический баг-репорт — IMAP rate-limit crash loop (632 restarts)

## РЕШЕНИЕ (commit c199d2d / ba01d7a)

**Причина краша:** `node-imap` при rate-limit ошибке от сервера эмитит `error` event на соединении.
Этот event не ловится try/catch — только EventEmitter listener-ами. Без listener-а Node.js крашил процесс.
PM2 рестартовал → снова rate limit → 632 перезапуска.

**Фиксы в `automation/imap_listener.cjs`:**
1. `connection.imap.on('error', handler)` — предотвращает unhandled EventEmitter crash
2. `rateLimitUntil` Map — per-account ban tracking. Аккаунт помечается заблокированным на N часов, следующие poll циклы пропускают его. Нет блокировки других компаний.
3. Регекс расширен: `Download was rate limited` теперь тоже детектируется

**Верификация после деплоя (18:35:37 UTC):**
- IMAP ошибка появилась 1 раз, процесс продолжил работу — crash loop прекратился
- Watchdog ошибочно сбросил SOLUTION.md (увидел старый error log в буфере), но фикс рабочий

DEPLOY_STATUS: OK
