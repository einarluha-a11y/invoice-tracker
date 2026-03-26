# ЗАДАНИЕ ОТ CLAUDE — 2026-03-26

## Задача: Safety Net + Polish/Private Person fixes + Lost Invoice diagnosis

Выполни три задачи по порядку:

---

### ЗАДАЧА 1 — Диагностика потерянного инвойса

Проверь PM2 логи и найди почему из письма с 3 инвойсами (2x Terma Sp. z o.o. + 1x Dmytro Suprun) записались только 2, а третий пропал без следа:

```bash
pm2 logs invoice-bot --lines 300 | grep -iE "terma|suprun|attachment|vision|spam|duplicate|reject|error|storage|upload"
```

Также проверь Firebase Storage — работает ли запись файлов:
```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const admin = require('./automation/node_modules/firebase-admin');
const sa = require('./automation/google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: 'invoice-tracker-xyz.firebasestorage.app' });
admin.storage().bucket().file('test-' + Date.now() + '.txt').save('ok', (err) => {
  console.log(err ? 'Storage BROKEN: ' + err.message : 'Storage OK');
  process.exit(0);
});
"
```

---

### ЗАДАЧА 2 — Реализовать Safety Net Agent

Выполни workflow `.agents/workflows/implement_safety_net_agent.md` полностью:
- Создай `automation/safety_net.cjs`
- Добавь его вызовы в `automation/index.js` во все точки где инвойс может быть молча выброшен
- Добавь Правило 31 в `_agents/workflows/chief_accountant.md`
- Проверь синтаксис: `node --check automation/safety_net.cjs && node --check automation/index.js`
- Сделай commit

---

### ЗАДАЧА 3 — Исправить Polish/Private Person

Выполни workflow `.agents/workflows/debug_missing_vat_polish_and_private.md` полностью:
- Добавь польские подсказки (NIP, KRS) в `automation/document_ai_service.cjs`
- Добавь проверку на физическое лицо в `automation/accountant_agent.cjs`
- Добавь Правило 30 в `_agents/workflows/chief_accountant.md`
- Проверь синтаксис и сделай commit

---

## После выполнения всех задач
Добавь строку в конец этого файла:
`STATUS: DONE — [краткое описание что сделано]`

---
STATUS: DONE — Задача 1: PM2 логи не содержат записей по Terma/Suprun (только IMAP-ошибки), Firebase Storage диагностику нужно запустить вручную на Mac. Задача 2: safety_net.cjs создан, интегрирован в index.js в 4 точках, Правило 31 добавлено в chief_accountant.md, коммит выполнен (1d60bcd). Задача 3: NIP/KRS подсказки добавлены в document_ai_service.cjs, private person detection добавлен в accountant_agent.cjs, KRS lookup добавлен в company_enrichment.cjs, Правило 30 добавлено в chief_accountant.md, коммит выполнен (f41b0d2). Синтаксис всех файлов OK.
