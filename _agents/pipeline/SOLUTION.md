# SOLUTION

PHASE: BUGFIX
ROUND: 4
TASK: Firestore restore timeout too short for Railway cold start

## АНАЛИЗ

ROUND 2 добавил `clearTimeout(_restoreTimer)` — но warning `loadRateLimitsFromFirestore timed out`
продолжает появляться в каждом деплое (09:41, 09:43, 09:45 UTC).

Причина: Railway cold start — первый Firestore запрос устанавливает gRPC соединение,
это занимает > 8s. Таймаут срабатывал раньше чем Firestore успевал ответить.

Подтверждение: в логах обоих последних деплоев:
```
[RateLimit] ⏳ Restored 2 active IMAP ban(s) from Firestore on startup.
[imap-daemon] ⚠️  loadRateLimitsFromFirestore timed out — starting loops anyway
```

Оба сообщения — значит Firestore отвечал, но позже 8s.

## ИСПРАВЛЕНИЕ

Файл: `automation/imap_daemon.cjs`

`RESTORE_TIMEOUT_MS`: **8000 → 15000** (8s → 15s)

Достаточно для Railway gRPC cold start, не блокирует запуск надолго.

## СТАТУС СИСТЕМЫ

- Нет crash loop с 09:45 UTC ✅
- Баны восстанавливаются из Firestore ✅
- invoice-imap стабилен ✅

## РЕЗУЛЬТАТ

- `node --check` ✅
- commit: `fix(imap): increase Firestore restore timeout 8s→15s (cold start on Railway takes >8s)`
- push → main ✅

DEPLOY_STATUS: OK
