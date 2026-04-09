# SOLUTION

PHASE: WAITING
ROUND: 1
TASK: Watchdog автоматический баг-репорт — ВЫПОЛНЕНО

## ЧТО БЫЛО

- **invoice-imap**: Crash loop: 632 рестартов.
- Причина: `rateLimitUntil` — Map в памяти. При рестарте PM2 обнулялась.
  Процесс снова пытался подключиться → rate limit → краш → рестарт → 632 раза.

## ЧТО СДЕЛАНО

Файл: `automation/imap_listener.cjs`

Добавил персистентность rate limit через файл `.rate_limits.json`:
1. При запуске — загружаем сохранённые баны из файла
2. При каждом `rateLimitUntil.set(...)` — сохраняем в файл
3. Баны теперь переживают PM2 restart → crash loop невозможен

Коммит: `b703a72` — `fix: persist IMAP rate limits to disk — prevent crash loop on PM2 restart`

DEPLOY_STATUS: OK
