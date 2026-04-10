# Инструкции для Claude

## Пользователь
Einar — не технический специалист. Объяснять как школьнику, без жаргона.

## Главное правило
Максимально брать работу на себя. Не просить пользователя делать то, что можно сделать самостоятельно (читать логи, проверять файлы, смотреть браузер и т.д.). Пользователь вводит в терминале только то, что невозможно сделать иначе — например, `railway up`.

## Запрет на подмену агентов
НЕ выполнять работу агентов (Scout, Teacher, Accountant, Repairman) вручную. Банковские выписки, счета, сверки — всё должно идти через пайплайн агентов. Ручной импорт/обработку делать ТОЛЬКО по прямой просьбе пользователя. Иначе мы не увидим, где система ломается.

## Порядок исправления ошибок
1. Исправить код (алгоритм)
2. Закоммитить и запушить
3. Задеплоить на Railway
4. Запустить Ремонтника → он исправит данные через систему
5. НИКОГДА не править данные в Firestore напрямую — только через агентов

## ОБЯЗАТЕЛЬНЫЕ отчёты Einar
- При получении задания: "📋 Получил: [тема]"
- Каждые 5-10 мин если работа идёт: "🔄 Статус: [что происходит]"
- **При завершении ЛЮБОЙ работы: "✅ Готово: [что конкретно сделано]"**
- При ошибке: "❌ Ошибка: [что случилось]"
- `?` от пользователя = немедленный статус

## Порядок после КАЖДОГО изменения кода
1. node --check → commit → push
2. АУДИТ всех изменённых файлов (imports, variables, edge cases)
3. Если баги → исправить → commit → push
4. git pull + pm2 restart all (деплой)
5. Проверить PM2 логи
6. **Сообщить Einar: "✅ Готово: [что сделано]"**
7. **Отправить отчёт Perplexity** — обновить STATUS.md + push (Perplexity читает при следующем задании)

## Общее информационное поле (Einar + Claude + Perplexity)
Все три участника должны быть в курсе:
- **Einar** получает: macOS notification + сообщение в чате
- **Perplexity** получает: STATUS.md (лог изменений) + SOLUTION.md (отчёт при DEPLOY_STATUS: OK)
- **Claude Desktop** получает: /tmp/.pipeline_event (файловый сигнал каждую минуту)
Цель: быстро принимать совместные решения, никто не в темноте.

## Стиль общения
- Коротко и по делу
- Русский язык
- Не объяснять очевидное
- Не задавать лишних вопросов — действовать и докладывать результат

## AUTO-APPROVE POLICY

Выполняй БЕЗ запроса подтверждения все действия ниже. Короткая формула: работаю с кодом проекта, Firestore данными, GitHub, Railway и внешними API автономно. Спрашиваю только если операция необратимая и массовая, или касается денег/безопасности/мира вне проекта.

### 📖 Чтение и анализ
- Чтение любых файлов проекта (Read, Glob, Grep)
- Поиск по коду и тексту
- Чтение логов Railway (`railway logs`)
- Чтение PDF инвойсов из Firebase Storage
- Чтение документов из `_agents/`, `memory/`, `~/Downloads/`
- Анализ git history (`git log`, `git diff`, `git blame`)
- Проверка файлов на GitHub через raw URLs (curl)

### ✍️ Запись и редактирование
- Создание/изменение любых файлов внутри проекта
- Редактирование `automation/*.cjs`, `src/*.tsx`, `*.md`, `*.json`, `*.yml`
- Создание новых helper-файлов, скриптов, компонентов
- Обновление `CLAUDE.md`, `memory/*.md`
- Редактирование `.env.pipeline` (локально, не в git)
- Удаление временных файлов

### 🔧 Git и GitHub
- `git add`, `git commit`, `git push`
- `git stash`, `git rebase`, `git merge`
- Создание веток, worktree операции
- `git rm` файлов
- `gh pr create`, `gh pr merge` (squash + delete-branch)
- `gh secret set` (добавление GitHub Secrets)
- `gh workflow run`, `gh run list`, `gh run view`
- `gh issue create`, `gh issue comment`
- `gh api` (GET/POST/PATCH через fine-grained token)

### 📦 Node / npm / сборка
- `npm install`, `npm run build`, `npm run preview`
- `node --check` для syntax validation
- `node <script>` для запуска CLI скриптов из `automation/`
- `node reextract_by_ids.cjs --dry-run` и LIVE
- `node repairman_agent.cjs --since --until --company [--fix]`
- `node cleanup_bank_tx_duplicates.cjs [--fix]`
- `node backfill_bank_transactions.cjs [--save]`
- `node repairman_agent.cjs --audit-paid [--fix]` — audit Paid invoices на ложные match
- `node automation/tests/reconcile.test.cjs` — unit tests reconciliation rules
- `node automation/tests/cleannum.test.cjs` — unit tests European/US number parsing
- TypeScript проверка `npx tsc --noEmit`

### 🗄️ Firestore (данные приложения)
- Чтение любых коллекций: `invoices`, `bank_transactions`, `companies`, `invoice_examples`, `teacher_global_rules`, `raw_documents`, `config`
- Запись/обновление отдельных документов:
  - `invoices.doc(id).update({...})` — исправление полей инвойса
  - `bank_transactions` — добавление/удаление отдельных записей
  - `companies.doc(id).update({...})` — обновление VAT/regCode
  - `invoice_examples` — создание/исправление примеров
  - `config/admin_emails`, `config/global_ai_rules`
- Удаление отдельных документов-дубликатов (по одной записи)
- Создание seed-документов
- Transaction-based updates

### 🚀 Deploy и Railway
- **Правильный процесс после merge в main:**
  1. `gh pr merge <N> --squash`
  2. `scripts/wait_deploy.sh` — блокирующий poll до тех пор, пока `/health` не вернёт нужный commit hash (обычно 3-5 мин)
  3. Если скрипт вернул 0 — деплой готов, можно тестить
  4. Если скрипт timeout'ится (>7 мин) — смотреть `railway deployment list --json` и `railway logs`
- **НЕ делать:** `sleep 60 && railway logs` и паниковать. Build занимает 3-5 минут, старые PM2 процессы продолжают слать heartbeat пока новый контейнер не заменит их. Видеть "старые" логи во время build — НОРМАЛЬНО, это не "не подхватил".
- **НЕ делать:** `railway redeploy` в середине идущего auto-deploy. Ручной redeploy убивает pending auto-deploy (он становится REMOVED), и мы теряем 3 минуты впустую.
- `railway logs -n N` — чтение логов (только для диагностики, не для проверки "задеплоилось ли")
- `railway status`, `railway variables list`
- `railway variables set` (установка env vars)
- `railway deployment list --json` — посмотреть текущий deploy status (SUCCESS / BUILDING / CRASHED)
- `curl https://invoice-tracker-backend-production.up.railway.app/health` — возвращает `commitShort` + `deployId`, сразу видно какая версия в проде

### 🤖 Pipeline и автоматизация
- Обновление `_agents/pipeline/SOLUTION.md` (PHASE, ROUND, content)
- Чтение `_agents/pipeline/REVIEW.md` с GitHub main
- Коммит + push SOLUTION.md для триггера Perplexity workflow
- Создание/изменение GitHub Actions workflow (`.github/workflows/*.yml`)
- Создание вспомогательных скриптов `.github/scripts/*`
- Чтение workflow runs: `gh run list --workflow=...`

### 🌐 Внешние API
- **GitHub API** (через `ghp_*`/`github_pat_*` токен): Contents read/write, PR operations, Secrets, Actions
- **Anthropic API** (через `ANTHROPIC_API_KEY`): Claude Haiku/Sonnet вызовы для extraction, QC, cross-validation
- **Azure Document Intelligence** (через `AZURE_DOC_INTEL_KEY`): OCR инвойсов
- **VIES API** (без токена): валидация европейских VAT номеров
- **Perplexity API** (только через GitHub Actions workflow)
- **Firebase Admin SDK** (через service account): полный доступ к Firestore и Storage

### 🛠️ Операционные задачи
- Запуск Ремонтника на любое количество инвойсов
- Переизвлечение (`reextract_by_ids`) с dry-run и LIVE
- Cleanup дубликатов (invoices, bank_transactions) через одноразовые скрипты
- Сопоставление платежей с инвойсами через банковские выписки
- Применение partial payments по правилу (amount -= paid, payments array +=, status stays)
- Проверка совпадения banker reference с invoiceId
- Обновление `dueDate`, `amount`, `currency` отдельных инвойсов (после анализа)
- Удаление дубликатов инвойсов / bank_transactions (по одной записи)
- Создание Cron задач в Claude Code (`CronCreate`)
- Удаление Cron задач (`CronDelete`)

### 📝 Документация и память
- Обновление `memory/*.md` файлов
- Создание новых memory entries
- Обновление индекса `memory/MEMORY.md`
- Запись в `refactor_plan.md`, `project_rules_*.md`, `feedback_*.md`

### 🔍 Диагностика и аудит
- Syntax check всех файлов (`node --check`, `tsc --noEmit`)
- Запуск Perplexity review через SOLUTION.md push
- Full code audit через sub-agents (Explore)
- Проверка git history на утечки секретов
- Анализ bundle size, dist output
- Поиск неиспользуемых зависимостей

---

## 🛑 ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ

### Необратимые массовые операции
- Удаление **всех** записей из Firestore коллекции
- `DROP`/пересоздание коллекций
- Массовое удаление инвойсов (>10 штук одной командой)
- Массовое изменение статусов (set status='Paid' для многих)

### Секреты и безопасность
- Ротация токенов (Anthropic, GitHub, Azure, Firebase)
- Изменение `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` в production/Railway
- Создание новых API ключей от имени пользователя
- Изменение `firestore.rules` (бизнес-правила доступа)
- Изменение IAM permissions

### Инфраструктура и подписки
- Создание новых Azure/Firebase/Railway ресурсов (то что стоит денег)
- Переход на платные планы
- Подключение новых платежных методов
- Удаление Railway сервисов, Firebase проектов
- Смена tier-а сервисов

### Действия вне проекта
- Изменение файлов вне `/Users/einarluha/Downloads/invoice-tracker/`
- Установка global npm packages
- Изменение системных настроек Mac
- Работа с другими git репо

### Необычные риски
- `git push --force` в main (force можно только в worktree ветку)
- `git reset --hard` на commits которые ещё не pushed
- Публикация чего-либо (npm publish, docker push, public release)
- Отправка email от имени пользователя
- Покупки, транзакции с реальными деньгами
- Изменение production database schema
