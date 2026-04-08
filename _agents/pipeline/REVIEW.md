# REVIEW от Perplexity — 2026-04-08 09:55 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

ВЕРДИКТ: CHANGES_NEEDED  
ОЦЕНКА: Код webhook_receiver.cjs и ecosystem.config.cjs написан правильно, с верификацией HMAC-SHA256 и быстрым health-check. Замена polling на webhook улучшит надёжность pipeline. Структура решения логична и соответствует TASK-20.  
ЗАМЕЧАНИЯ:  
1. **Cloudflare Tunnel не прод-готов**: trycloudflare.com — временный URL без постоянного домена и TLS-сертификата. GitHub требует HTTPS с проверкой SSL[1][2]. Нужно настроить постоянный tunnel (`cloudflared tunnel create`, DNS CNAME) или ngrok с custom domain.  
2. **Нет идемпотентности**: При retry от GitHub (до 3-10 раз[1]) detached-процесс Claude CLI запустится многократно. Добавить проверку `X-GitHub-Delivery` ID в Firestore/файл для skip дубликатов[2].  
3. **Ответ >10с = fail**: `child_process.spawn('node', ...)` detached может занять >10с. GitHub обрежет соединение[1]. Отвечать 200 сразу после spawn, логировать PID.  
4. **PM2 env не в Railway**: `ecosystem.config.cjs` с `env: { WEBHOOK_PORT: 3001 }` не деплоится на Railway (PM2 там не используется). Добавить `railway variables set WEBHOOK_PORT=3001`.  
5. **Secret в .env.pipeline**: Правильно, но после генерации `openssl rand -hex 20` → `railway variables set WEBHOOK_SECRET=...` для Railway.  
6. **Events слишком узко**: "Just the push event" пропустит merge в main. Выбрать "Pushes" + "Pull requests" (merged)[3].  
7. **Нет логирования signature**: Для debug добавить `console.log('Signature verified')` без secret[2].

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
