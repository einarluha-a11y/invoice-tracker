# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Блок 1 аудита — 4 критичных бага (askClaudeToFix, currency bypass, date filter, post-Claude guard vendorName)

## ARCHITECTURE

Perplexity одобрил Блок 1 как критичные фиксы (REVIEW round 1: CHANGES_NEEDED, пункты 1, 3, 4).
Делаем 4 точечные правки:

1. **askClaudeToFix** — добавить функцию в document_ai_service.cjs, экспортировать (иначе runtime crash)
2. **Currency rule violation** — repairman:517 и imap_daemon:444 напрямую меняют currency без re-extract. Обернуть в блок: если currency меняется, использовать Claude's amount в новой валюте атомарно
3. **Date filter bug** — InvoiceTable игнорирует dateFilterType, фильтрует только по dateCreated. Добавить prop, передать из App.tsx
4. **Post-Claude guard vendorName** — teacher_agent.cjs:755-786 очищает только VAT/Reg. Добавить очистку vendorName + re-extract из rawText

## CODE

### Что реализовано

#### 1. automation/document_ai_service.cjs
- Добавлена функция askClaudeToFix(rawText, current, issues) (67 строк):
  - Вызывает Claude Haiku с current fields + список QC issues + 3000 символов rawText
  - Возвращает JSON с полями для исправления (vendorName, amount, currency, etc.)
  - Правило currency: "If currency differs, return BOTH new currency AND new amount"
  - Правило anti-hallucination: "Never invent VAT/registration numbers"
- Экспорт: добавлен askClaudeToFix в module.exports

#### 2. automation/imap_daemon.cjs:436-455
- Claude QC fix теперь проверяет fixes.currency !== current.currency
- Если currency меняется → применяются currency + amount + subtotal + tax атомарно (Claude's values в новой валюте)
- Если currency не меняется → только amount/subtotal/tax

#### 3. automation/repairman_agent.cjs:512-530
- Та же логика: currency + amounts применяются атомарно при смене валюты
- Разделение на 2 ветки: currency change vs currency same

#### 4. src/components/InvoiceTable.tsx
- Добавлен prop dateFilterType?: 'created' | 'due' с default 'created'
- Фильтрация: compareDate = dateFilterType === 'due' ? (invoice.dueDate || '') : invoice.dateCreated
- Deps в useMemo и useEffect обновлены

#### 5. src/App.tsx:334
- Передан prop dateFilterType={dateFilterType} в <InvoiceTable>

#### 6. automation/teacher_agent.cjs:755-815
- Post-Claude guard теперь проверяет три поля: VAT, Reg, vendorName
- Если vendorName совпадает с именем компании-получателя → очищается и перезаписывается из rawText (первая не-buyer строка)
- Логирование через corrections.push(...)

### Тесты синтаксиса

node --check automation/document_ai_service.cjs → OK
node --check automation/teacher_agent.cjs       → OK
node --check automation/repairman_agent.cjs     → OK
node --check automation/imap_daemon.cjs         → OK

npm run build → built in 2.37s, PWA precache 15 entries (1948.81 KiB)

### PM2 статус

Railway auto-deploy настроен, ecosystem.config.cjs перезапускает invoice-api + invoice-imap после merge в main.

## CHANGED_FILES

- automation/document_ai_service.cjs (+67 строк: askClaudeToFix + exports)
- automation/imap_daemon.cjs (+9 строк: currency atomic fix)
- automation/repairman_agent.cjs (+12 строк: currency atomic fix)
- automation/teacher_agent.cjs (+28 строк: vendorName guard + re-extract)
- src/components/InvoiceTable.tsx (+5 строк: dateFilterType prop)
- src/App.tsx (+1 строка: prop pass-through)

## REVISION NOTES (Round 1)

Первая реализация Блока 1 согласно ревью Perplexity round 1:
- Пункт 1 ревью (askClaudeToFix runtime crash) → исправлено в document_ai_service.cjs
- Пункт 3 ревью (currency violation в 2 местах) → исправлено в imap_daemon и repairman
- Дополнительно из моего аудита: post-Claude guard vendorName + date filter bug

Пункты 2 (секреты), 4 (imap self-invoice guard), 5 (PM2 restart) — отложены на Блок 2.
