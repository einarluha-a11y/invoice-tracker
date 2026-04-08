# SOLUTION

PHASE: DONE
ROUND: 13
TASK: TASK-29 — активация Merit Aktiva API

DEPLOY_STATUS: OK
node --check: ALL OK (automation/*.cjs)
build: OK — main chunk 293 kB (was 1617 kB), no chunk warnings

## Что сделано

TASK-29 выполнен. Код Merit Aktiva уже готов (`automation/merit_sync.cjs`). Нужно только добавить credentials в Railway.

---

## Инструкция для Einar: как активировать Merit Aktiva

### Шаг 1 — Получить API ключи в Merit Aktiva

1. Войди в Merit Aktiva: https://aktiva.merit.ee
2. Перейди: **Seaded** (Настройки) → **Integratsioonid** (Интеграции) → **API seaded** (API настройки)
3. Там будет:
   - **API ID** — длинная строка букв и цифр
   - **API Key** — секретный ключ
4. Скопируй оба значения (сохрани в безопасном месте)

> Если не видишь раздел API — нужно включить API доступ в настройках компании (Seaded → Ettevõte → API kasutus).

---

### Шаг 2 — Добавить в Railway

В терминале выполни (по одной команде):

```bash
railway variables set MERIT_API_ID=<вставь_сюда_API_ID>
railway variables set MERIT_API_KEY=<вставь_сюда_API_Key>
```

После этого Railway автоматически перезапустит сервис — интеграция активируется без изменений кода.

---

### Шаг 3 — Проверить

```bash
node automation/merit_sync.cjs --test --id <любой_invoice_id>
```

---

## Статус компонентов

| Компонент | Статус |
|-----------|--------|
| `merit_sync.cjs` — API клиент + HMAC auth | ✅ Готов |
| `merit_aktiva_agent.cjs` — agent wrapper | ✅ Готов |
| `bank_statement_processor.cjs` — вызывает syncPaymentToMerit() | ✅ Подключено |
| `MERIT_API_ID` в Railway | ⏳ Ждёт credentials от Einar |
| `MERIT_API_KEY` в Railway | ⏳ Ждёт credentials от Einar |
