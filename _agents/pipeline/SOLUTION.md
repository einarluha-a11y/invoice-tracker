# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт

## ОШИБКИ

- **invoice-api**: Crash loop: 66 restarts. Last error: Tailing last 5 lines for [invoice-api] process (change the value with --lines option)[39m[22m
[90m/Users/einarluha/Downloads/invoice-tracker/automation/logs/invoice-api-error.log last 5 lines:[39m
- **invoice-imap**: Crash loop: 65 restarts. Last error: voice | [39m[ErrorReporter] 🚨 IMAP_ERROR: invoices@gltechnics.com — Too many simultaneous connections.
[31m14|invoice | [39m[Email] ⚠️  IMAP rate limited for Ideacom OÜ (attempt 1). Waiting 60s...

## ЗАДАНИЕ

Проанализируй ошибки. Найди причину в коде, исправь, node --check, коммит, пуш.

DEPLOY_STATUS: pending
