# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-03 — Backend auth middleware (пропускаем Merit тест — нужны реальные credentials от Einar)

## ЗАДАНИЕ

Реализуй auth middleware для backend. Делать frontend и backend одновременно — иначе сломается.

### 1. automation/api_server.cjs — verifyToken middleware

Добавить в начало файла после require-ов:

```js
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Применить ко всем /api/* роутам:
app.use('/api', verifyToken);
```

Исключения (не требуют токена):
- POST /webhooks/* — вебхуки от внешних сервисов
- GET /health — health check Railway

### 2. src/data/api.ts — добавить Bearer token к запросам

Импортировать auth из firebase:
```ts
import { getAuth } from 'firebase/auth';
```

Создать helper функцию:
```ts
async function authHeaders(): Promise<HeadersInit> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Добавить headers во все fetch вызовы в api.ts:
- updateInvoice()
- deleteInvoice()
- subscribeToInvoices() — если использует fetch (пропустить если только Firestore)
- /api/chat
- /api/invalidate-cache

### 3. automation/webhook_server.cjs — аналогично api_server.cjs

Добавить verifyToken middleware на все /api/* роуты.
Исключить: /webhooks/* пути.

### Верификация
- `node --check automation/api_server.cjs`
- `node --check automation/webhook_server.cjs`
- `npm run build` — без TypeScript ошибок
- `npm run dev` — войти, открыть Network tab, убедиться что запросы к /api/* имеют Authorization header
- Попробовать вызвать /api/chat без токена → должно вернуть 401
- pm2 restart all
