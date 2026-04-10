# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: PM2 автоматический баг-репорт — критические ошибки

## ОШИБКИ В PM2 ЛОГАХ

- **invoice-imap**: [Dead-Man Switch] Firestore write crashed. Escalating to external webhook... request to https://firestore.googleapis.com/v1/projects/invoice-tracker-xyz/databases/(default)/docu

## ПРИЧИНА

`batch.commit()` в `error_reporter.cjs` падал с `INVALID_ARGUMENT: Transaction too big` — документы в `system_logs` имеют большие поля `message`. Ошибка пробрасывалась в outer `catch` и каждый раз активировала Dead-Man Switch. Цикл: poll → reportError → batch fail (100 docs) → Dead-Man Switch → логируется → следующий poll → повторяется.

## ИСПРАВЛЕНИЕ

`automation/error_reporter.cjs`:
- Уменьшен CHUNK с 100 до 10 (10 docs × ~10KB = ~100KB per batch — не превышает лимит)
- Каждый chunk-батч обёрнут в собственный try/catch — ошибка прунинга логируется как warning, не активирует Dead-Man Switch

## Верификация
- node --check automation/error_reporter.cjs — OK

DEPLOY_STATUS: OK
