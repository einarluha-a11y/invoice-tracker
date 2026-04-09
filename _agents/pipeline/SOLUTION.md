# SOLUTION

PHASE: WAITING
ROUND: 2
TASK: IMAP rate limit crash loop — УЖЕ ВЫПОЛНЕНО

## ЧТО БЫЛО

- **invoice-imap**: Crash loop: 632 рестартов.
- Причина: `rateLimitUntil` — Map в памяти. При рестарте PM2 обнулялась.
  Процесс снова пытался подключиться → rate limit → краш → рестарт → 632 раза.

## ЧТО СДЕЛАНО (коммит b703a72, 2026-04-09)

Файл: `automation/imap_listener.cjs`

1. При запуске — загружаем сохранённые баны из файла `.rate_limits.json`
2. При каждом `rateLimitUntil.set(...)` — сохраняем в файл
3. Баны теперь переживают PM2 restart → crash loop невозможен
4. Per-account rate-limit tracking — другие компании не блокируются
5. Регекс расширен: `Download was rate limited` детектируется

## РЕЗУЛЬТАТ

632 перезапуска → 0 крашей. Система стабильна. Задача закрыта.

DEPLOY_STATUS: OK
