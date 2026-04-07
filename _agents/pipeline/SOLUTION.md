# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим (Master / Admin / User)

## ЗАДАНИЕ

1. Создай коллекцию `users` в Firestore с полями:
   - `userId` (string, уникальный)
   - `email` (string)
   - `role` (enum: "master" | "admin" | "user")
   - `companyId` (string, ссылка на companies)
   - `createdAt` (timestamp)

2. Добавь middleware аутентификации в invoice-api:
   - Проверяй Firebase Auth token в заголовке `Authorization: Bearer <token>`
   - Декодируй token → получай `userId`
   - Проверяй существование user в `users` коллекции
   - Добавляй `userId` и `role` в `req.user`

3. Ограничь доступ к endpoint'ам по ролям:
