# SOLUTION

PHASE: BUGFIX
ROUND: 5
TASK: Eliminate false timeout warning on Railway cold start

## АНАЛИЗ

После ROUND 4 (15s timeout) warning `loadRateLimitsFromFirestore timed out` продолжал появляться.
Логи Railway 09:47 UTC показывали оба сообщения одновременно:
```
[RateLimit] ⏳ Restored 2 active IMAP ban(s) from Firestore on startup.
[imap-daemon] ⚠️  loadRateLimitsFromFirestore timed out — starting loops anyway
```

Корневая причина: **race condition**, а не недостаточный таймаут.
setTimeout (15000ms) и `loadRateLimitsFromFirestore()` разрешались одновременно.
`clearTimeout(_restoreTimer)` выполнялся ПОСЛЕ срабатывания таймера — слишком поздно.
Warning печатался даже когда Firestore успешно ответил.

## ИСПРАВЛЕНИЕ

Файл: `automation/imap_daemon.cjs`

1. Добавлен флаг `_firestoreResolved = false` — устанавливается в `.then()` Firestore
2. В setTimeout: предупреждение печатается **только если `!_firestoreResolved`**
3. Удалён `clearTimeout` (больше не нужен — логика через флаг)
4. Таймаут увеличен **15s → 30s** для дополнительного запаса

Теперь warning появится только если Firestore действительно не ответил за 30s.

## СТАТУС СИСТЕМЫ

- `node --check` ✅
- commit: `fix(imap): eliminate false timeout warning — flag + 15s→30s guard`
- push → main ✅

DEPLOY_STATUS: OK
