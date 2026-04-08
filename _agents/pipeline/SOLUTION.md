# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Fix 401 error when opening PDF attachments from dashboard

## ЗАДАНИЕ

При открытии вложенных PDF файлов из дашборда (кнопка скрепки) возвращается 401 Unauthorized. Файлы хранятся в Firebase Storage, URL подписанные — но токен истёк или CORS блокирует.

Проверить:
1. Как InvoicePdfViewer.tsx загружает PDF — через прямой URL или через API proxy
2. Если прямой URL — Firebase Storage signed URLs могут истекать. Нужен proxy через backend
3. api_server.cjs уже имеет `/api/pdf-proxy` endpoint — проверить что он работает
4. Фронтенд должен вызывать `/api/pdf-proxy?url=<encoded-firebase-url>` вместо прямого URL

Исправить:
- InvoicePdfViewer.tsx — использовать /api/pdf-proxy
- Проверить что api_server.cjs pdf-proxy endpoint доступен без CORS проблем
- node --check всех изменённых файлов
- npm run build

## Верификация
- Открыть инвойс на дашборде → нажать скрепку → PDF отображается без 401
- В логах PM2 нет ошибок pdf-proxy

## РЕШЕНИЕ

InvoicePdfViewer.tsx: убрана логика "try direct first, fall back to proxy". Теперь **всегда идём сразу через `/api/pdf-proxy`**.

Причина 401: старый код пробовал прямой Firebase Storage URL с `Authorization: Bearer <token>` — но Firebase Storage не принимает Firebase ID-token в заголовке. Это приводило к 401 на прямом запросе, а при падении catch — вторичный запрос к proxy мог не сработать если токен не был передан корректно.

Теперь:
1. Получаем Firebase ID-token
2. Сразу вызываем `/api/pdf-proxy?url=<encoded>` с `Authorization: Bearer <token>`
3. Backend (Admin SDK) скачивает файл из Storage без ограничений

- node --check: OK (CJS файлы)
- npm run build: OK
- DEPLOY_STATUS: OK
