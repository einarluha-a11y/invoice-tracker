require('dotenv').config({ path: __dirname + '/.env' });
const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic API
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- CLOUD HOSTING & API SUPPORT ---
// This server handles ONLY HTTP endpoints: webhook intake, AI chat, and health checks.
// All IMAP polling and invoice processing runs exclusively in imap_daemon.cjs.
const app = require('./webhook_server.cjs');
const PORT = process.env.PORT || 3000;

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // AI Chat Filter Logic
        const today = new Date().toISOString().split('T')[0];
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            temperature: 0.1,
            system: `You are an AI assistant managing an invoice tracking system.
Today's date is ${today}.
The user will ask you a question in natural language about their invoices.
Your goal is to translate their intent into specific table filter parameters and a polite reply.
You MUST output ONLY valid JSON matching this schema exactly:
{
  "filters": {
    "searchTerm": "vendor name or ID if mentioned, else empty string",
    "status": "Paid, Pending, Overdue, Unpaid, or All",
    "dateFilterType": "due or created. Use 'due' if the user asks about payment deadlines (до, оплатить), use 'created' if they ask about when it was issued/received",
    "dateFrom": "YYYY-MM-DD if a start date is implied, else empty string",
    "dateTo": "YYYY-MM-DD if an end date/deadline is implied, else empty string"
  },
  "reply": "A short, polite conversational response acknowledging the action (in the user's language, usually Russian)"
}

Example 1: "Покажи неоплаченные счета до конца марта"
{"filters": {"searchTerm":"", "status":"Unpaid", "dateFilterType":"due", "dateFrom":"", "dateTo":"2026-03-31"}, "reply": "Конечно, вот ваши неоплаченные счета до конца марта."}

Example 2: "Сколько я должен заплатить Теле2 на этой неделе?"
{"filters": {"searchTerm":"Tele2", "status":"Unpaid", "dateFilterType":"due", "dateFrom":"", "dateTo":"2026-03-08"}, "reply": "Отфильтровал неоплаченные счета от Tele2 до конца текущей недели."}

Example 3: "Покажи счета за январь"
{"filters": {"searchTerm":"", "status":"All", "dateFilterType":"created", "dateFrom":"2026-01-01", "dateTo":"2026-01-31"}, "reply": "Показываю все счета, созданные в январе."}
`,
            messages: [{ role: "user", content: message }]
        });

        const jsonString = response.content[0].text.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
        const aiOutput = JSON.parse(cleanJson);
        res.json(aiOutput);
    } catch (error) {
        console.error("[API Error] /api/chat failed:", error);
        res.status(500).json({ error: 'Internal server error processing AI response.' });
    }
});

app.get('/', (req, res) => {
    res.send('🤖 Invoice Automation Bot is Active & Running!');
});

app.listen(PORT, () => {
    console.log(`[Web] Express server listening on port ${PORT} (Webhook API & Chat & Healthchecks).`);
});
