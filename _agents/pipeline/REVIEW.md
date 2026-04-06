# REVIEW от Perplexity — 2026-04-06 08:09 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED
ОЦЕНКА: Предложенные фиксы для cleanVendorName и cleanNum логичны и решают реальные проблемы с данными (кавычки в именах, парсинг сумм). Структура мониторинга REVIEW.md продумана для автоматизации пайплайна. Соответствует Chief Accountant Charter (улучшает качество извлечения данных).

ЗАМЕЧАНИЯ:
1. **Мониторинг**: `/tmp/.pipeline_state` не сохранит состояние при рестарте PM2/Railway — использовать Firestore `config/pipeline_state` (создать документ если нет). Добавить `setInterval` в отдельный `automation/pipeline_monitor.cjs` с `pm2 start --name pipeline-monitor`.
2. **cleanVendorName**: Добавить в `utils.cjs` экспорт и JSDoc: `/** Удаляет кавычки/угловые скобки из vendorName, нормализует пробелы */`. Применить также в `repairman_agent.cjs` ~line 250 (vendorName из bank_tx).
3. **cleanNum**: В `utils.cjs` строка 22 сделать полноценную `cleanNum(s)`: `s = s.replace(/[€$,\s]/g,'').replace(',','.'); return Number(s) || 0;`. НЕ менять `Number(s)` на `parseFloat` — Number лучше для edge cases вроде '1,234.56'.
4. **Edge cases**: Добавить тест в `cleannum.test.cjs`: `assert(cleanNum('1 234,56 €') === 1234.56); assert(cleanVendorName(' "ООО \"Рога\" " ') === 'ООО Рога');`.
5. **Противоречия**: В `reconcile_rules.cjs` строки 77-78 — проверить не сломается ли tolerance matching после cleanNum (добавить ±0.01 epsilon).
6. **Верификация**: После фиксов добавить `node automation/core/utils.cjs --test` (создать экспорт тестов). Запустить `repairman_agent.cjs --audit-paid --fix` для проверки на проде.
7. **Deploy**: После push в main — `railway up`, `pm2 restart all`, мониторить логи 5 мин.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
