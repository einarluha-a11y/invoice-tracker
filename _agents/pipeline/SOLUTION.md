# SOLUTION

PHASE: DONE
ROUND: 4
DEPLOY_STATUS: OK

## Что сделано
Добавил `preferRest: true` в Firestore init (`automation/core/firebase.cjs`).

**Проблема:** gRPC cold start на Railway занимал 8-12 секунд, из-за чего IMAP daemon зависал при старте.  
**Решение:** REST API вместо gRPC — cold start сокращается до 1-2 секунд. Это постоянное исправление, а не временный обход через timeout.

## Изменённый файл
- `automation/core/firebase.cjs:34` — добавлена строка `if (db) db.settings({ preferRest: true });`

## Коммит
`feat(imap): switch Firestore to REST API for cold start fix`

## Проверки
- node --check: ✅
- git push: ✅ (rebase + push в main)
