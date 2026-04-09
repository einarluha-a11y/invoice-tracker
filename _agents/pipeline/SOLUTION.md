# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт

## ОШИБКИ

- **invoice-imap**: Crash loop: 632 restarts. Last error: AIL',
[31m0|invoice- | [39m  source: 'protocol'
[31m0|invoice- | [39m}
[31m0|invoice- | [39m[ErrorReporter] 🚨 IMAP_ERROR: invoices@ideacom.ee — Download was rate limited. Try again in 16 hours.

## ЗАДАНИЕ

Проанализируй ошибки. Найди причину в коде, исправь, node --check, коммит, пуш.

## РЕШЕНИЕ (commit c199d2d)

**Причина краша:** `node-imap` при rate-limit ошибке от сервера эмитит `error` event на соединении.
Этот event не ловится try/catch — только EventEmitter listener-ами. Без listener-а Node.js крашит процесс.
PM2 рестартует → снова rate limit → 632 перезапуска.

**Фиксы в `automation/imap_listener.cjs`:**
1. `connection.imap.on('error', handler)` — предотвращает unhandled EventEmitter crash
2. `rateLimitUntil` Map — per-account ban tracking. Аккаунт помечается заблокированным на N часов, следующие poll циклы пропускают его. Нет блокировки других компаний.
3. Регекс расширен: `Download was rate limited` теперь тоже детектируется

DEPLOY_STATUS: OK
