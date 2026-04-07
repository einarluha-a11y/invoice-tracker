# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: PM2 автоматический баг-репорт — критические ошибки

## ОШИБКИ В PM2 ЛОГАХ

- **invoice-api**: [31m9|invoice- | [39m    code: 'storage/invalid-argument',
- **invoice-api**: [31m9|invoice- | [39mTue Apr  7 21:37:07 EEST 2026 TypeError: cleanVendorNameXYZ is not a function
- **invoice-api**: Crash loop: 229 restarts
- **invoice-imap**: Crash loop: 220 restarts

## ЗАДАНИЕ

Проанализируй ошибки выше. Найди причину в коде, исправь, проверь syntax (node --check), закоммить и запуши.
После исправления добавь DEPLOY_STATUS: OK в конец этого файла.

## Верификация
- `node --check` всех изменённых файлов
- PM2 процессы стабильны (0 рестартов за 1 минуту)
