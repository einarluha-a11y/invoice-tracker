require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
async function run() {
    try {
        const response = await anthropic.models.list();
        console.log(response.data.map(m => m.id).join('\n'));
    } catch(e) {
        console.error(e.message);
    }
}
run();
