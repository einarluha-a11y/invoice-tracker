# SOLUTION

PHASE: BUGFIX
ROUND: 2
TASK: Анализ кода restore IMAP bans + timeout защита

## АНАЛИЗ КОДА

grep -r "Restored.*IMAP ban" automation/ ->
  imap_listener.cjs:73: Restored ${loaded} active IMAP ban(s) from Firestore on startup.

Функции:
- loadRateLimitsFromFirestore() -- imap_listener.cjs:59-79
- _saveRateLimitsFirestore() -- imap_listener.cjs:49-57
- Firestore коллекция: config/imap_rate_limits

Диагностика:
- Функция имеет try/catch (строки 60, 76) -- Firestore-ошибки не крашат
- Проблема: await loadRateLimitsFromFirestore() без таймаута. Если Firestore зависнет (не ошибка, просто нет ответа) -- pollLoop() не запустится -> event loop пуст -> PM2 restart -> crash loop.

## ИСПРАВЛЕНИЕ (commit 52033ad)

Добавлен Promise.race + 8-секундный таймаут в imap_daemon.cjs.
Если Firestore не отвечает за 8 сек -- предупреждение + pollLoop() запускается без ожидания.

node --check: OK

DEPLOY_STATUS: OK
