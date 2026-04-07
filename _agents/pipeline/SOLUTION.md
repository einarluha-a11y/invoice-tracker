# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: PM2 автоматический баг-репорт — критические ошибки

## ОШИБКИ В PM2 ЛОГАХ

- **invoice-imap**: [31m10|invoice | [39m[Dead-Man Switch] Firestore write crashed. Escalating to external webhook... 3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.

## ЗАДАНИЕ

Проанализируй ошибки выше. Найди причину в коде, исправь, проверь syntax (node --check), закоммить и запуши.
После исправления добавь DEPLOY_STATUS: OK в конец этого файла.

## Верификация
- `node --check` всех изменённых файлов
- PM2 процессы стабильны (0 рестартов за 1 минуту)
