# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Crash loop invoice-imap — too many connections ban

## ПРИЧИНА

`imap_listener.cjs`: бан "Too many simultaneous connections" был 5 минут.
PM2 перезапускает процесс быстрее чем истекает бан, но:
1. После 5 мин бан истекал → новый коннект к IMAP → снова "too many" → петля
2. На Railway (эфемерная FS): `_saveRateLimitsFirestore()` вызывался без `await` — бан терялся при рестарте контейнера до завершения записи в Firestore

## ИСПРАВЛЕНИЕ

Файл: `automation/imap_listener.cjs`

1. Бан "too many connections": **5 min → 30 min**
   - Достаточно длинный чтобы пережить циклы PM2-рестартов
2. `await _saveRateLimitsFirestore()` в catch-блоке
   - Бан гарантированно сохраняется в Firestore до выхода из функции

## РЕЗУЛЬТАТ

- `node --check` ✅
- commit: `fix(imap): increase 'too many connections' ban 5min→30min + await Firestore persist`
- push → main ✅

DEPLOY_STATUS: OK
