# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Два фикса: кэш правил + хардкод storage bucket

## ЗАДАНИЕ 1 — Инвалидация кэша при изменении Settings

**Проблема:** бэкенд кэширует AI-правила на 60 сек в `core/firebase.cjs`. Когда пользователь меняет правила в Settings — система до 60 сек работает по-старому.

**Решение:** добавить endpoint `POST /api/invalidate-cache` в `api_server.cjs` который сбрасывает кэш немедленно. Фронтенд вызывает его после сохранения Settings.

Шаги:
1. В `core/firebase.cjs` — экспортировать функцию `invalidateRulesCache()` которая обнуляет кэш
2. В `api_server.cjs` — добавить endpoint:
   ```js
   app.post('/api/invalidate-cache', (req, res) => {
     invalidateRulesCache();
     res.json({ ok: true });
   });
   ```
3. В фронтенде (Settings компонент) — после успешного сохранения вызвать:
   ```js
   await fetch(`${API_URL}/api/invalidate-cache`, { method: 'POST' });
   ```

## ЗАДАНИЕ 2 — Убрать хардкод storage bucket

**Проблема:** `automation/core/firebase.cjs:23` — имя бакета вшито в код.

**Решение:** заменить на переменную окружения:
```js
// Было:
const bucket = admin.storage().bucket('invoice-tracker-xxx.appspot.com');

// Стало:
const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
```

Добавить `FIREBASE_STORAGE_BUCKET` в `.env` и `.env.production`.

## Верификация
- `node --check automation/core/firebase.cjs`
- `node --check automation/api_server.cjs`
- `pm2 restart all`
