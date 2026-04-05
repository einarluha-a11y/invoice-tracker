# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Аудит — исправить 6 находок (parseFloat vs cleanNum, дубли функций, dead code, dedup scan, /api/chat, ecosystem hardening)

## ARCHITECTURE

### Верификация находок (все подтверждены через grep)

1. **parseFloat вместо cleanNum**: 48 использований parseFloat в automation/**/*.cjs. Из них ~20 на `.toFixed(2)` pattern (безопасные — конвертируют вычисленный float) и ~28 на неконтролируемых строках из Firestore/CSV/OCR.
2. **Дубли функций**: `cleanNum` (core/utils.cjs), `parseAmount = cleanNum` (accountant_agent.cjs:11 — backward-compat alias), `parseNumGlobal` — упоминается в Charter как имя, но не существует в коде.
3. **Dead code**: automation/supreme_supervisor.cjs, automation/overseer_agent.cjs, automation/ai_retry.cjs существуют, НЕ импортируются нигде, НЕ в ecosystem.config.cjs. Чистый dead weight.
4. (пропущено в аудите)
5. **Dedup full scan** — imap_daemon.cjs:212-224: `where('companyId', '==', X).get()` → full scan всех инвойсов компании ради match по fileBasename. При 1000+ инвойсах = 1000 doc reads per save.
6. **/api/chat 501** — api_server.cjs:12-14 возвращает 501. Frontend AiChat.tsx:75 всё ещё fetch'ит этот endpoint. User имеет рабочий ANTHROPIC_API_KEY (используется в teacher/scout).
7. **ecosystem.config.cjs**: нет restart_delay, max_restarts, exp_backoff_restart_delay. watch:true уже есть, но может привести к loop при краше.

### Решения

#### 1+2. parseFloat → cleanNum + консолидация имён

**Единое имя:** `cleanNum` (core/utils.cjs). Причины:
- Нейтральное, отражает действие
- Уже в core/utils.cjs — shared module
- `parseAmount` — alias только для backward compat в одном файле
- `parseNumGlobal` — не существует, это артефакт старого Charter

**Что меняем:**
- `parseAmount` alias в accountant_agent.cjs → удаляем, заменяем все parseAmount(...) → cleanNum(...)
- Все небезопасные parseFloat в automation/*.cjs → cleanNum
- Безопасные parseFloat(X.toFixed(2)) → остаются (это float→float нормализация, не парсинг строки)
- Charter (project rules memory) обновить: `parseNumGlobal` → `cleanNum`

**Точный список файлов для замены (неsafe parseFloat):**
- `automation/imap_daemon.cjs` — 12 мест (строки 123, 465-467, 572, 625, 685, 781, 827, 835, 842, 861)
- `automation/accountant_agent.cjs` — 3 места (400, 479, 588) + parseAmount alias удалить
- `automation/repairman_agent.cjs` — 6 мест (279, 504-506, 761, 783)
- `automation/teacher_agent.cjs` — 1 место (1085 — user input)
- `automation/backfill_bank_transactions.cjs` — 4 места (95, 102, 109, 125)
- `automation/import_csv_bank_transactions.cjs` — 4 места (77, 84, 91, 107)
- `automation/reconcile_bank_statement.cjs` — 2 места (78, 116)
- `automation/search_agent.cjs` — 2 места (через parseAmount import из accountant)

**Что НЕ трогаем:**
- `core/utils.cjs:22` — `parseFloat(s)` внутри самого cleanNum (там уже нормализованная строка)
- Все `parseFloat(X.toFixed(2))` паттерны (teacher_agent 525, 526, 729; accountant 92, 441; document_ai_service 356)
- Score color (teacher_agent 1261-1267) — UI, входы безопасны
- `webhook_server.cjs:320` — .toFixed pattern

#### 3. Dead code cleanup

Удаляем из репозитория:
- `automation/supreme_supervisor.cjs`
- `automation/overseer_agent.cjs`
- `automation/ai_retry.cjs`

Проверяем через grep что никто не импортирует, потом `git rm`.

#### 5. Dedup по fileBasename — composite индекс или denorm поле

**Два варианта:**

A. **Composite index + where clause:**
```
// Store fileBasename as denormalized field on save
const fileBasename = (data.fileUrl.match(/\d+_([^?]+)/)?.[1] || '').toLowerCase();
// Index: invoices(companyId, fileBasename)
const existing = await invoicesRef
    .where('companyId', '==', data.companyId)
    .where('fileBasename', '==', fileBasename)
    .limit(1)
    .get();
```
Плюс: O(1) lookup. Минус: нужен firestore.indexes.json update + миграция (backfill fileBasename для существующих).

B. **Deterministic document ID через hash** (как bank_dedup):
Использовать `companyId + fileBasename` → SHA-1 → doc ID. Атомарный `.create()` catches ALREADY_EXISTS. Но инвойсы уже имеют свой ID schema — нельзя менять.

**Выбираем A.** Добавляем `fileBasename` field в writeToFirestore, composite index в firestore.indexes.json, backfill script (optional — existing данные просто не будут иметь поля, новый код будет строить постепенно). Для edge case когда у существующего инвойса нет `fileBasename` — fallback на старую логику full scan, но только если query вернул пусто.

#### 6. /api/chat — восстановить через Claude Haiku

AiChat.tsx продолжает использовать /api/chat для natural language filter queries ("show me overdue invoices from Tallinn last month"). У нас уже есть ANTHROPIC_API_KEY в Railway. Восстанавливаем endpoint:

```
// api_server.cjs
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/chat', rateLimit(30, 60_000), async (req, res) => {
    const msg = String(req.body?.message || '').slice(0, 500);
    if (!msg) return res.status(400).json({ error: 'empty message' });
    try {
        const r = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: `You are an invoice tracker filter assistant. Extract filter criteria from user query.
Return JSON: { reply: "human response", filters: { status?, vendor?, dateFrom?, dateTo?, amountMin?, amountMax? } }
Status values: Paid, Pending, Overdue. Dates: YYYY-MM-DD.`,
            messages: [{ role: 'user', content: msg }],
        });
        const text = r.content[0]?.text || '{}';
        const m = text.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : { reply: text };
        res.json(parsed);
    } catch (err) {
        console.error('[api/chat]', err.message);
        res.status(500).json({ error: 'AI chat failed', reply: 'Извините, попробуйте позже' });
    }
});
```

Rate limit уже есть. Безопасность: входные данные обрезаются до 500 chars, JSON parsing в try/catch.

#### 7. ecosystem.config.cjs hardening

```
module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './automation/api_server.cjs',
      watch: true,
      ignore_watch: ['node_modules', 'automation/logs', 'automation/dlq', '*.json', '*.flag', '*.log'],
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '500M',
      error_file: './logs/invoice-api-error.log',
      out_file: './logs/invoice-api-out.log',
    },
    { ... same for invoice-imap ... }
  ]
};
```

Защищает от infinite restart loop при систематическом краше (например, если DB недоступна).

### План реализации (CODE phase)

**Порядок — от мелкого к крупному:**

1. **ecosystem.config.cjs** — добавить restart flags (5 строк)
2. **Dead code cleanup** — `git rm` 3 файлов + проверить что не импортируются
3. **/api/chat restore** — api_server.cjs Haiku call + package.json (если @anthropic-ai/sdk ещё не в deps) + .env var check
4. **Dedup fileBasename** — denorm поле в writeToFirestore + firestore.indexes.json (composite companyId+fileBasename) + fallback
5. **cleanNum refactor** — замена parseFloat → cleanNum по всем файлам (механический рефакторинг)
6. **Charter memory update** — обновить `project_architecture.md` / `project_rules_currency.md`: `parseNumGlobal` → `cleanNum`

### Риски

1. **cleanNum behavior на edge cases** — вход "0" → returns 0 (safe). Negative "-500" → works. Scientific notation "1e5" — parseFloat пропустит, cleanNum тоже (оба regex-strip делают). Тесты: unit tests нужны.
2. **Firestore composite index build time** — несколько минут после deploy, но запросы работают. Fallback на full scan чтобы не было downtime.
3. **AiChat Haiku cost** — 30 req/min rate limit × Haiku input token cost минимален. OK.
4. **Dead code — вдруг импортируется через динамический require?** — grep покажет все строковые упоминания. Если ничего не найдено — безопасно удалять.

### Верификация

- Unit tests для cleanNum: европейский "1.200,50", US "1,200.50", negative, null/undefined, "0", empty, currency-prefixed "€500"
- `node --check` всех изменённых файлов
- `npm run build` — TS check InvoiceTable + любые типы
- Manual test /api/chat локально через curl
- Syntax ecosystem.config.cjs
- `node repairman_agent.cjs --dry-run` — smoke test что всё читается

### Что НЕ меняем

- Схему invoices/bank_transactions (кроме добавления `fileBasename` поля)
- Логику reconciliation (только что прошли pipeline)
- Teacher Charter rules
- i18n, UI layout
