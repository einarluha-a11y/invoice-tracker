# SOLUTION

PHASE: CODE
ROUND: 3
TASK: Блок 3 аудита — косметика (i18n, dead code review, memory update, firestore.rules allowlist)

## ARCHITECTURE

Блоки 1 и 2 одобрены Perplexity как CODE_APPROVED.
Блок 3 — 4 задачи из финального списка ревизии:
- 3.1 i18n hardcoded строки (Settings.tsx, InvoiceModal.tsx)
- 3.2 Dead code review (customRules, supervisorCritique, reconcilePayment)
- 3.3 Обновить memory/refactor_plan.md (устаревшие упоминания Google DocAI)
- 3.4 Перенести firestore.rules email allowlist в Firestore config collection

## CODE

### 3.1 i18n hardcoded strings
**InvoiceModal.tsx**: 5 hardcoded строк заменены на i18n ключи:
- "Arve nr" → t('modal.invoiceNumber')
- "VAT" → t('modal.vat')
- "Рег. код" → t('modal.registrationCode')
- "Sub" → t('modal.subtotal')
- "Tax" → t('modal.tax')

**Settings.tsx:148**: "Имя и Email обязательны." → t('settingsPage.requiredFieldsError')

**i18n.ts**: добавлены ключи для всех 3 языков:
- RU: invoiceNumber="Номер инвойса", vat="VAT", registrationCode="Рег. код", subtotal="Без НДС", tax="НДС", requiredFieldsError="Имя и Email обязательны."
- EN: invoiceNumber="Invoice Number", vat="VAT", registrationCode="Reg. Code", subtotal="Subtotal", tax="Tax", requiredFieldsError="Company Name and Email are required."
- ET: invoiceNumber="Arve nr", vat="KMKR", registrationCode="Rg-kood", subtotal="Summa km-ta", tax="Käibemaks", requiredFieldsError="Nimi ja E-post on kohustuslikud."

### 3.2 Dead code review — не изменено
- `reconcilePayment()` — **живой код**, вызывается из imap_daemon:855 (bank statement) и reprocess.cjs
- `customRules` parameter — deprecated, но передаётся из imap_daemon:443 и webhook_server:178 — нельзя удалить без API break
- `supervisorCritique` parameter — передаётся из maker_checker:33 — оставлен для compat
- Audit report был неточен, все перечисленные dead code — либо живые, либо deprecated API с реальными callers

### 3.3 memory/refactor_plan.md — полное обновление
Файл полностью переписан, отражает актуальную архитектуру:
- Шаг 1 Scout: Azure Document Intelligence (не Google DocAI)
- Шаг 2 Teacher: 10-step pipeline (self-invoice guard → parallel load → normalize → Charter → global → examples → Claude QC → post-Claude guard)
- Шаг 3 Accountant: business rules (VIES, CMR filter, dedup, Overdue auto)
- Шаг 4 imap_daemon writeToFirestore: 4-я линия защиты
- Ссылка на project_rules_currency.md (правило currency change)
- Список ключевых файлов + шифр history (2026-04-04 Azure migration, 2026-04-05 blocks 1-3)

### 3.4 firestore.rules — config collection allowlist
**firestore.rules**: email allowlist перенесён из hardcoded в Firestore `config/admin_emails`:
- `isBootstrapAdmin()` — fallback hardcoded список (защита от lockout)
- `isConfigAdmin()` — проверяет `config/admin_emails.emails` через `exists()` + `get()`
- `isAdmin()` = bootstrap OR config
- `config/admin_emails`: read доступен всем admins, write только bootstrap admins (защита от лишения доступа)

**Firestore seed**: документ `config/admin_emails` создан через node скрипт:
```
emails: ['buhus2203@gmail.com', 'einar.luha@gmail.com', 'info@accountingresources.eu']
```

Теперь добавление нового пользователя = обновление массива в Firestore (не требует deploy).

### Тесты
```
$ npm run build → built, PWA precache 15 entries (1949.65 KiB)
```

### PM2 статус
Railway auto-deploy через merge в main, `ecosystem.config.cjs` перезапускает invoice-api + invoice-imap.
firestore.rules применяется отдельно через `firebase deploy --only firestore:rules` (если настроен).

## CHANGED_FILES

- `src/components/InvoiceModal.tsx` (-5 hardcoded / +5 i18n ключей)
- `src/components/Settings.tsx` (-1 hardcoded / +1 i18n)
- `src/i18n.ts` (+18 новых ключей для RU/EN/ET)
- `firestore.rules` (переписаны для config-based allowlist)
- `memory/refactor_plan.md` (полностью обновлён — Azure architecture)
- Firestore: seeded `config/admin_emails` document

## REVISION NOTES (Round 3)

- 3.1: все hardcoded UI строки перенесены в i18n (3 языка)
- 3.2: dead code review показал что reconcilePayment — живой, deprecated params нужны для API compat
- 3.3: refactor_plan.md обновлён до актуальной архитектуры Azure (был устаревший Google DocAI)
- 3.4: email allowlist decoupled от deploy-cycle — теперь в Firestore

Все 3 блока аудита закрыты. Ничего не требует срочных действий.
