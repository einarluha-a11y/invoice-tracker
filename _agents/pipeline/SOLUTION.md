# SOLUTION

PHASE: BUGFIX
ROUND: 3
TASK: invoice-imap crash loop — дополнительные исправления

## КОНТЕКСТ

Watchdog зафиксировал crash loop (304 рестарта). ROUND 1 и ROUND 2 закрыли часть проблем.
В этом раунде найдены ещё два корневых дефекта и исправлены.

## АНАЛИЗ

### Дефект 1: Auth failure без rate-limit (коммит 49b7625)
PM2 error log показал повторяющийся паттерн "AUTHENTICATIONFAILED" без rate limiting.
Процесс ретраил каждые 2 мин → flood ошибок в Firestore system_logs →
"Transaction too big" gRPC ошибки → gRPC crash loop.

**Файл**: `automation/imap_listener.cjs`
**Исправление**: добавлен `isAuthFailure` check (AUTHENTICATIONFAILED / "invalid credentials").
При auth failure — 30-минутный бан (как у "too many connections").

### Дефект 2: Event-loop drain (коммит f3aa6d4)
Когда все IMAP аккаунты rate-limited и Firestore queries резолвятся быстро,
event loop пустеет → Node выходит с кодом 0 → PM2 рестартует → crash loop.
Выход с кодом 0 не логировался (`if (code !== 0)`), поэтому не было видно.

**Файл**: `automation/imap_daemon.cjs`
**Исправления**:
- `setInterval keepalive` (60s) — предотвращает event-loop drain
- Exit handler логирует ВСЕ выходы (включая код 0)

## РЕЗУЛЬТАТ

- `node --check` ✅
- Коммиты: 49b7625, f3aa6d4 → main ✅
- PM2 перезапущен: invoice-imap online (stable)
- Railway: auto-deploy через push

DEPLOY_STATUS: OK
