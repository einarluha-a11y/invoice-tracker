# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Исправить 401 при открытии файлов + race condition в perplexity_review.yml

## Выполнено

### 0. Concurrency в perplexity_review.yml
Добавлена `concurrency` группа — только один Perplexity Review работает одновременно:
```yaml
concurrency:
  group: perplexity-review
  cancel-in-progress: false
```

### 1. src/components/InvoicePdfViewer.tsx — 401 fix
- Добавлен импорт `getAuth` из `firebase/auth`
- В `loadFile()` получаем Firebase ID токен текущего пользователя
- Токен передаётся в `Authorization: Bearer ...` header при прямом fetch и через proxy

### 2. automation/api_server.cjs — /api/pdf-proxy
- Добавлен endpoint `GET /api/pdf-proxy` (requireRole user/admin/master)
- Admin SDK скачивает файл из Storage — 401 исключён
- Поддержка `gs://` и `https://firebasestorage.googleapis.com/...`

### 3. storage.rules + firebase.json
- `storage.rules`: разрешает read/write аутентифицированным пользователям
- `firebase.json`: добавлена секция `"storage"`
- Для применения: `firebase deploy --only storage`

### Верификация
- `node --check` ✅, `npm run build` ✅

DEPLOY_STATUS: OK
