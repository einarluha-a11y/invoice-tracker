# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: watchdog крашил на Railway — hardcoded локальный путь PROJECT

## ПРОБЛЕМА

`automation/watchdog.cjs` строка 19:
```
const PROJECT = '/Users/einarluha/Downloads/invoice-tracker';
```
На Railway этот путь не существует (`/app` вместо него) → watchdog падал сразу при запуске с `ENOENT`.

## ИСПРАВЛЕНИЕ

```js
const PROJECT = path.resolve(__dirname, '..');
```

`__dirname` = директория файла (`/app/automation`) → `..` = корень проекта (`/app`). Работает и локально, и на Railway.

## ПРОВЕРКА

- `node --check automation/watchdog.cjs` → OK
- commit `9bbc7d4`, push в main

## СТАТУС

- tunnel-manager crash loop (820 рестартов): ожидаемо — cloudflared не установлен на Railway (ENOENT). Это отдельная проблема, не из этого BUGFIX.
- watchdog теперь не крашит из-за пути

DEPLOY_STATUS: OK
