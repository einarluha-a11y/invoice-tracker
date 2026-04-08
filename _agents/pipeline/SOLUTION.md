# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Исправить 401 при открытии приложенных файлов к инвойсам

## ПРОБЛЕМА

InvoicePdfViewer.tsx делает прямой fetch(url) к Firebase Storage без Authorization токена.
После внедрения auth middleware Firebase Storage отклоняет запросы с 401.

## ИСПРАВЛЕНИЕ

### 1. src/components/InvoicePdfViewer.tsx

Заменить прямой fetch на fetch с Firebase Auth токеном:

```ts
import { getAuth } from "firebase/auth";

const loadFile = async () => {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    
    try {
        response = await fetch(url, { mode: "cors", headers });
        if (!response.ok) throw new Error("direct-failed");
    } catch {
        // CORS fallback — proxy тоже должен получить токен
        const apiBase = import.meta.env.VITE_API_URL || "";
        const proxyUrl = `${apiBase}/api/pdf-proxy?url=${encodeURIComponent(url)}`;
        response = await fetch(proxyUrl, { headers });
    }
};
```

### 2. automation/api_server.cjs — /api/pdf-proxy

Убедиться что endpoint /api/pdf-proxy:
- Принимает Authorization header от фронтенда
- Передаёт его при запросе к Firebase Storage
- Либо использует Admin SDK для получения файла (тогда токен не нужен)

Лучший вариант для proxy — использовать Firebase Admin SDK:
```js
app.get("/api/pdf-proxy", verifyToken, async (req, res) => {
    const { url } = req.query;
    // Admin SDK имеет полный доступ — не нужен токен пользователя
    const bucket = admin.storage().bucket();
    // Извлечь путь из URL и скачать через Admin SDK
});
```

### 3. Проверить Firebase Storage Rules

В `storage.rules` убедиться что правила разрешают чтение аутентифицированным пользователям:
```
rules_version = "2";
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```
Задеплоить: `firebase deploy --only storage`

### Верификация
- `npm run build` без ошибок
- Открыть инвойс с вложением — файл должен загрузиться без 401

