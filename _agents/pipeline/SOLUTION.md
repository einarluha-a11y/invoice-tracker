# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Ревизия всего кода Invoice-Tracker — выявление неэффективных связей, багов, рисков безопасности

## ARCHITECTURE

### Анализ задачи
Проведён детальный аудит 4 параллельных агентов по разным частям системы:
1. Extraction pipeline (Scout, Teacher, Accountant, Repairman, imap_daemon)
2. Data flow + Firestore operations
3. Frontend + конфигурация
4. Rules, guards, memory, pipeline infrastructure

Цель — найти критические баги, дублирование логики, неэффективные связи, проблемы безопасности.

### Найденные проблемы (по критичности)

#### 🔴 КРИТИЧЕСКИЕ

**1. `askClaudeToFix` — функция вызывается, но не существует**
- `automation/repairman_agent.cjs:501` и `automation/imap_daemon.cjs:436` делают `require('./document_ai_service.cjs').askClaudeToFix`
- В `document_ai_service.cjs:446` экспорт: `{ processInvoiceWithDocAI, cleanNum, parseDocAiDate, inferDescription }` — `askClaudeToFix` отсутствует
- Эффект: при вызове Claude QC → ReferenceError, код падает

**2. Секреты в открытом виде в `.env` файлах**
- `automation/.env` содержит: IMAP_PASSWORD, OPENAI_API_KEY, ANTHROPIC_API_KEY, AZURE_DOC_INTEL_KEY в plaintext
- `.env.pipeline` — в .gitignore ✅, но нужна проверка git history на наличие старых коммитов с токенами
- Рекомендация: перенести в Railway secret variables, ротировать все токены

**3. Конфликт dedup логики на 3 уровнях**
- `imap_daemon.writeToFirestore()` — проверка по file basename + invoiceId+vendor + date+amount+vendor
- `accountant_agent` — 6-месячное окно с LEGAL_SUFFIX правилом
- `repairman_agent` — похожая но не идентичная логика
- Риск: разные логики могут дать противоречивый результат (один сохраняет, другой удаляет)

**4. Currency change bypass в 2 местах**
- `automation/repairman_agent.cjs:517`: `updates.currency = fixes.currency` — без re-extract amount
- `automation/imap_daemon.cjs:444`: `tempParsed[0].currency = fixes.currency` — без re-extract amount
- Нарушают правило записанное в `memory/project_rules_currency.md` — всегда использовать `setCurrencySafely()`

**5. IMAP daemon без self-invoice guard**
- Guard есть в Teacher (`teacher_agent.cjs:345-431`) и Accountant (`accountant_agent.cjs:226-248`)
- В `imap_daemon.cjs` нет финальной проверки перед `writeToFirestore`
- Риск: если оба предыдущих guard не сработают, данные Global Technics/Ideacom попадут в поля поставщика

#### 🟡 СЕРЬЁЗНЫЕ

**6. Date filter bug в UI**
- `src/App.tsx:128-137` использует `dateFilterType` ('created' | 'due')
- `src/components/InvoiceTable.tsx:92` всегда фильтрует по `dateCreated`, игнорирует параметр
- Дашборд показывает одно, фильтр делает другое

**7. Post-Claude guard не очищает `vendorName`**
- `teacher_agent.cjs:755-786` — второй guard очищает только VAT/Reg
- `accountant_agent.cjs:244` — прямой комментарий "Don't clear vendorName"
- vendorName может остаться с именем покупателя

**8. Reconciliation query без limit**
- `src/data/api.ts:471-474`: `getDocs(where('companyId', '==', ...))` без orderBy и limit
- На базе 1000+ транзакций — риск OOM в браузере

**9. Reconciliation logic bug**
- `src/data/api.ts:459`: `if (d.status !== 'Paid' || (d.currency && d.currency !== 'EUR'))`
- Логика `||` пропускает валютные оплаченные инвойсы
- Должно быть `&&`

**10. Неиспользуемый аргумент rawText в validateAndTeach**
- `imap_daemon.cjs:418` и `repairman_agent.cjs:375` передают 3-й параметр
- `validateAndTeach(invoiceData, companyId)` принимает только 2
- rawText берётся из invoiceData._rawText, работает но хрупко

#### 🟢 КОСМЕТИКА

**11. Hardcoded тексты вне i18n**
- `Settings.tsx:148`: "Имя и Email обязательны." (русский в коде)
- `InvoiceModal.tsx:104`: "Arve nr" (эстонский)
- Ещё: "VAT", "Рег. код", "Sub", "Tax" в modal

**12. Hardcoded email allowlist в firestore.rules**
- 3 email захардкожены — добавление пользователя требует redeploy

**13. Нет Firestore индекса для фильтра по dueDate**
- Только `companyId + dateCreated` есть, для dueDate потребуется новый индекс

**14. refactor_plan.md в памяти упоминает Google Document AI**
- Не критично (план, не код), но устаревшая информация

**15. Dead code**
- `reconcilePayment()` в imap_daemon — 300 строк, unclear entry point
- `customRules` параметр в Accountant — неиспользуемый

### Метрики эффективности

| Метрика | Значение | Комментарий |
|---|---|---|
| Firestore reads/invoice | 12-14 | можно снизить до 6-8 с кешем |
| Firestore writes/invoice | 1 | хорошо |
| Claude API calls/invoice | 0.07-0.12 | дёшево (~$0.01/100 инвойсов) |
| Azure DocAI/invoice | 1 | ~2-5 сек |
| VIES API calls | ~0 (кеш 7 дней) | хорошо |
| Self-invoice guard | 3 места | избыточно, можно унифицировать |

### Что работает правильно

- ✅ Self-invoice guard на 3 уровнях (избыточно, но надёжно)
- ✅ Firestore transactions для атомарных записей
- ✅ VIES validation с 7-дневным кешем
- ✅ Credit notes с автоматическим offset
- ✅ Status logic (Pending/Overdue/Paid) согласована между backend и frontend
- ✅ Charter rules normalizer (RU/ET → canonical EN)
- ✅ setCurrencySafely() helper для unified currency change
- ✅ CMR header detection (multilingual, не смотрит description)
- ✅ Dedup by file basename (ловит race condition attachment+inline)
- ✅ Memory files актуальны (project_rules_currency.md записан)
- ✅ Pipeline infrastructure (SOLUTION, REVIEW, STATUS, pipeline_protocol)
- ✅ Perplexity agent + GitHub Actions workflow настроены

### План реализации (приоритеты)

**Блок 1 — критичные баги (1 коммит):**
1. Добавить `askClaudeToFix` в `document_ai_service.cjs` или убрать вызовы
2. Заменить `updates.currency = ` на `setCurrencySafely()` в repairman и imap_daemon
3. Исправить date filter в InvoiceTable (передать dateFilterType как prop)
4. Очистить `vendorName` в post-Claude guard

**Блок 2 — безопасность и оптимизация (2-3 коммита):**
5. Вынести secrets из `.env` в Railway variables, проверить git history
6. Добавить `limit(100)` в reconciliation query
7. Починить `if` логику в reconciliation (`||` → `&&`)
8. Убрать дублирующиеся self-invoice guard (оставить 1 место)

**Блок 3 — косметика:**
9. i18n hardcoded строки
10. Удалить dead code
11. Обновить memory/refactor_plan.md
12. Firestore index для dueDate фильтра
13. Hardcoded emails в firestore.rules → Firestore config collection

### Учтённые протоколы Charter
- **PM2 restart после automation/** — правило должно применяться после всех изменений в блоке 1
- **parseNumGlobal для сумм** — проверено, все используют `cleanNum` из `core/utils.cjs`
- **Anti-hallucination** — Claude fallback только при missing identity, не по умолчанию
- **Idempotency** — email UID сохраняется только после successful write в Firestore
- **Currency change rule** — записан в memory, но нарушается в 2 местах (пункты 4)

### Риски

1. **Каскадная потеря данных**: race condition между imap dedup → accountant dedup → repairman — могут удалить валидную запись
2. **Валютная подмена**: если валюта меняется в repairman/imap_daemon без setCurrencySafely() → amount в неправильной валюте
3. **Buyer data leak**: без IMAP guard данные Global Technics/Ideacom могут попасть в vendor fields при отказе Teacher guard
4. **Runtime crash**: вызов `askClaudeToFix` приведёт к падению процесса при первом срабатывании
5. **Безопасность**: если токены утекут — полный доступ к инвойсам и возможно банковским данным

### Вопрос к ревьюеру
С чего начинать фикс? Блок 1 — 4 конкретных правки, 1 коммит, ~10 минут с деплоем. Блок 2 требует ротации токенов и git history cleanup. Блок 3 — отложить на следующий спринт.

<!-- triggered: 2026-04-05T13:12:05Z -->
