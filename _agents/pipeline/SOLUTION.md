# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: False "timed out" warning after Firestore restore succeeds

## АНАЛИЗ (ответ на REVIEW.md)

Проверен `automation/imap_daemon.cjs` + `automation/imap_listener.cjs`.

Найдено в Railway логах:
```
[RateLimit] ⏳ Restored 2 active IMAP ban(s) from Firestore on startup.
[imap-daemon] ⚠️  loadRateLimitsFromFirestore timed out — starting loops anyway
```

Оба сообщения появляются вместе — это баг: `Promise.race` завершается (Firestore успел),
но `clearTimeout` не вызывался → таймер всё равно срабатывал → ложное предупреждение.

Баны на самом деле **загружались корректно** (первая строка подтверждает). Система работала,
но false alarm в логах мог вводить в заблуждение.

## ИСПРАВЛЕНИЕ

Файл: `automation/imap_daemon.cjs`

Добавлен `clearTimeout(_restoreTimer)` в `.then()` после `loadRateLimitsFromFirestore()`.
Теперь таймер отменяется при успешной загрузке, warning появляется только при реальном timeout.

## РЕЗУЛЬТАТ

- `node --check` ✅
- commit: `fix(imap): clear timeout when Firestore restore succeeds — suppress false 'timed out' warning`
- push → main ✅

DEPLOY_STATUS: OK
