# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим (Master / Admin / User)

## ЗАДАНИЕ

1. Создай Firestore коллекцию `users` с полями: `email`, `role` (master/admin/user), `companyId`, `createdAt`
2. Добавь в `companies` поле `ownerUserId` для связи с master user
3. Реализуй middleware авторизацию в `invoice-api`:
   - Проверка Firebase Auth token
   - Определи роль по `users.doc(userId).get()`
   - Master: полный доступ
   - Admin: CRUD invoices + stats своей company
   - User: только read своей company
4. Обнови все API endpoints с ролевыми проверками
5. Создай `/auth/setup` endpoint для начальной регистрации Master (один на проект)
6. Добавь JWT refresh в frontend (`src/`)

После реализации:
- `node --check` всех файлов
- Тест: создай 2 users (admin+user), проверь доступы
- Закоммить + push
- Добавь `DEPLOY_STATUS: OK`

## Верификация
- `node --check` + `npx tsc --noEmit`
- API тесты: `/invoices` доступны по ролям, 403 для неавторизованных
- Firestore: `users` коллекция создана, роли работают
- PM2 стабильность (0 restarts)
