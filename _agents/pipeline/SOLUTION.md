# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: TASK-05 — Кэш правил + хардкод storage bucket

## ЗАДАНИЕ

1. `core/firebase.cjs` — экспортировать `invalidateRulesCache()`
2. `api_server.cjs` — добавить `POST /api/invalidate-cache`
3. Frontend Settings — вызывать invalidate-cache после сохранения
4. `core/firebase.cjs:23` — заменить хардкод bucket на `process.env.FIREBASE_STORAGE_BUCKET`
5. Добавить `FIREBASE_STORAGE_BUCKET` в `.env` и `.env.production`

## ВЫПОЛНЕНО

- `invalidateRulesCache()` — уже экспортирован из `core/firebase.cjs` ✓
- `POST /api/invalidate-cache` — уже есть в `api_server.cjs` (requireRole admin/master) ✓
- Settings.tsx — уже вызывает `invalidateBackendCache()` после каждого сохранения ✓
- `core/firebase.cjs:23` — убран хардкод `'invoice-tracker-xyz.firebasestorage.app'`, теперь только `process.env.FIREBASE_STORAGE_BUCKET` ✓
- `.env` — добавлена строка `FIREBASE_STORAGE_BUCKET="invoice-tracker-xyz.firebasestorage.app"` ✓
- `.env.production` — добавлена строка `FIREBASE_STORAGE_BUCKET="invoice-tracker-xyz.firebasestorage.app"` ✓
- `node --check` ✓ все файлы
- `npm run build` ✓

DEPLOY_STATUS: OK
