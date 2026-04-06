# REVIEW от Perplexity — 2026-04-06 09:05 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED
ОЦЕНКА: Решение с invalidate-cache логично решает проблему задержки правил на 60 сек, фронт-бэк взаимодействие простое. Замена хардкода на env-переменную повышает гибкость конфигурации. Верификация покрывает syntax и рестарт.

ЗАМЕЧАНИЯ:
1. **Chief Accountant Charter**: не указано, какие именно правила кэшируются (teacher_global_rules/config?). Нужно подтвердить, что это **только** AI-rules для extraction/QC, а не бухгалтерские данные (invoices/payments) — иначе нарушаем "данные только через агентов".
2. **Кэш в firebase.cjs**: неясно текущая реализация — есть ли `rulesCache = null` или Map/Timer? Функция `invalidateRulesCache()` должна **полностью** описывать сброс (пример: `rulesCache = null; clearTimeout(timer);`).
3. **Фронтенд**: в каком **конкретном** компоненте Settings (src/Settings.tsx? src/admin/SettingsPage.tsx?) и после **какого** dispatch/save? Добавить try-catch на fetch с toast-уведомлением.
4. **Безопасность endpoint**: `/api/invalidate-cache` доступен всем? Добавить `authMiddleware` или check `req.user.role === 'admin'` — иначе любой юзер сломает кэш.
5. **Edge case**: если фронт не долетел (network error), кэш протухнет через 60сек — ок. Но добавить retry в фронте (2 попытки).
6. **Storage bucket**: подтвердить имя в `.env.production` на Railway (`railway variables list | grep BUCKET`) и fallback `|| 'default'` если env пустой.
7. **Полнота**: нет теста — добавить `automation/tests/cache-invalidation.test.cjs` с mock Firebase + endpoint call.
8. **Противоречия**: `pm2 restart all` вместо `railway up`? Railway auto-deploy через git push main.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
