require('dotenv').config({ path: __dirname + '/.env' });

// --- CLOUD HOSTING & API SUPPORT ---
// This server handles ONLY HTTP endpoints: webhook intake, AI chat, and health checks.
// All IMAP polling and invoice processing runs exclusively in imap_daemon.cjs.
const app = require('./webhook_server.cjs');
const PORT = process.env.PORT || 3000;

const { rateLimit } = require('./webhook_server.cjs');
// STUB: /api/chat endpoint previously used Anthropic Claude API.
// This endpoint is disabled until reimplemented with a new AI provider.
app.post('/api/chat', rateLimit(30, 60_000), async (req, res) => {
    res.status(501).json({ error: 'AI chat endpoint is temporarily disabled (Anthropic removed).' });
});

app.get('/', (req, res) => {
    res.send('🤖 Invoice Automation Bot is Active & Running!');
});

app.listen(PORT, () => {
    console.log(`[Web] Express server listening on port ${PORT} (Webhook API & Chat & Healthchecks).`);
});
