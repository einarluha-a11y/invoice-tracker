require('dotenv').config({ path: __dirname + '/.env' });

// --- CLOUD HOSTING & API SUPPORT ---
// This server handles ONLY HTTP endpoints: webhook intake, AI chat, and health checks.
// All IMAP polling and invoice processing runs exclusively in imap_daemon.cjs.
const app = require('./webhook_server.cjs');
const PORT = process.env.PORT || 3000;

const { rateLimit, requireRole } = require('./webhook_server.cjs');

// /api/chat — natural language filter assistant via Claude Haiku.
// Takes a user query like "show overdue invoices from Tallinn last month" and
// returns a parsed filter object that AiChat.tsx applies to the dashboard.
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

app.post('/api/chat', rateLimit(30, 60_000), requireRole(['user', 'admin', 'master']), async (req, res) => {
    if (!anthropic) {
        return res.status(503).json({ error: 'AI chat disabled: ANTHROPIC_API_KEY not set', reply: 'Сервис временно недоступен' });
    }
    const msg = String(req.body?.message || '').slice(0, 500).trim();
    if (!msg) return res.status(400).json({ error: 'empty message', reply: 'Пустой запрос' });

    try {
        const today = new Date().toISOString().slice(0, 10);
        const r = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: `You are an invoice tracker filter assistant. Extract filter criteria from user queries in Russian, English, or Estonian.

Today: ${today}

Return ONLY valid JSON (no markdown, no prose outside JSON):
{
  "reply": "short human response in the user's language confirming the filter",
  "filters": {
    "status": "Paid" | "Pending" | "Overdue" | null,
    "vendor": "search string" | null,
    "dateFrom": "YYYY-MM-DD" | null,
    "dateTo": "YYYY-MM-DD" | null,
    "amountMin": number | null,
    "amountMax": number | null
  }
}

Omit filter fields that don't apply. Resolve relative dates ("last month", "этот месяц", "möödunud kuu") based on today.`,
            messages: [{ role: 'user', content: msg }],
        });
        const text = r.content?.[0]?.text || '{}';
        const m = text.match(/\{[\s\S]*\}/);
        let parsed;
        try {
            parsed = m ? JSON.parse(m[0]) : { reply: text };
        } catch {
            parsed = { reply: text };
        }
        res.json(parsed);
    } catch (err) {
        console.error('[api/chat]', err.message);
        res.status(500).json({ error: 'AI chat failed', reply: 'Извините, попробуйте позже' });
    }
});

// POST /api/invalidate-cache — сбрасывает кэш AI-правил при изменении Settings (admin/master only)
const { invalidateRulesCache } = require('./core/firebase.cjs');
app.post('/api/invalidate-cache', requireRole(['admin', 'master']), (req, res) => {
    invalidateRulesCache();
    res.json({ ok: true });
});

// GET /api/users/list — список всех пользователей с ролями (только master)
const { admin: adminFb } = require('./core/firebase.cjs');
app.get('/api/users/list', requireRole(['master']), async (req, res) => {
    try {
        const listResult = await adminFb.auth().listUsers(1000);
        const users = listResult.users.map(u => ({
            uid: u.uid,
            email: u.email || '',
            role: (u.customClaims && u.customClaims.role) || 'user',
        }));
        res.json(users);
    } catch (err) {
        console.error('[api/users/list]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/roles — назначить роль пользователю (только master)
app.post('/api/users/roles', requireRole(['master']), async (req, res) => {
    const { uid, role } = req.body;
    const allowed = ['user', 'admin', 'master'];
    if (!uid || !role || !allowed.includes(role)) {
        return res.status(400).json({ error: 'uid and role (user|admin|master) required' });
    }
    try {
        await adminFb.auth().setCustomUserClaims(uid, { role });
        res.json({ ok: true, uid, role });
    } catch (err) {
        console.error('[api/users/roles]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/pdf-proxy — скачивает файл из Firebase Storage через Admin SDK (без 401)
// Фронтенд передаёт токен в Authorization для защиты самого эндпоинта,
// Admin SDK имеет полный доступ к Storage без пользовательского токена.
app.get('/api/pdf-proxy', requireRole(['user', 'admin', 'master']), async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url query param required' });
    }
    try {
        const storageBucket = adminFb.storage().bucket();
        let filePath;
        // Поддержка gs:// и https://firebasestorage.googleapis.com/...
        if (url.startsWith('gs://')) {
            filePath = url.replace(/^gs:\/\/[^/]+\//, '');
        } else {
            // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?...
            const match = url.match(/\/o\/([^?]+)/);
            if (!match) return res.status(400).json({ error: 'invalid Firebase Storage URL' });
            filePath = decodeURIComponent(match[1]);
        }
        const fileRef = storageBucket.file(filePath);
        const [metadata] = await fileRef.getMetadata();
        const contentType = metadata.contentType || 'application/octet-stream';
        const [fileBuffer] = await fileRef.download();
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'private, max-age=3600');
        res.send(fileBuffer);
    } catch (err) {
        console.error('[api/pdf-proxy]', err.message);
        res.status(500).json({ error: 'proxy failed: ' + err.message });
    }
});

app.get('/', (req, res) => {
    res.send('🤖 Invoice Automation Bot is Active & Running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`[Web] Express server listening on port ${PORT} (Webhook API & Chat & Healthchecks).`);
});
