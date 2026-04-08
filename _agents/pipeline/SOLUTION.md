# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Активировать Dropbox интеграцию — добавить credentials в .env и Railway

## ЗАДАНИЕ

Dropbox токены получены. Добавь в проект:

### 1. Добавить в .env.production и Railway environment variables:

DROPBOX_APP_KEY=2ex6ewd9ag00f94
DROPBOX_APP_SECRET=ayum6suv86iglbu
DROPBOX_REFRESH_TOKEN=6XWsZeEs0Y8AAAAAAAAAAX0cf9Av7VhnhJHFTDjuMuJEIZQabfV7pzZiTmvgMCgB

### 2. Добавить в Railway через CLI:
```bash
railway variables set DROPBOX_APP_KEY=2ex6ewd9ag00f94
railway variables set DROPBOX_APP_SECRET=ayum6suv86iglbu
railway variables set DROPBOX_REFRESH_TOKEN=6XWsZeEs0Y8AAAAAAAAAAX0cf9Av7VhnhJHFTDjuMuJEIZQabfV7pzZiTmvgMCgB
```

### 3. Проверить automation/dropbox_service.cjs
Убедиться что сервис читает эти переменные и инициализируется корректно.
Запустить тестовую загрузку файла если есть тестовый режим.

### 4. pm2 restart all после добавления переменных

### Верификация
- `railway variables` — убедиться что три переменные есть
- В логах PM2 не должно быть ошибок Dropbox при старте

