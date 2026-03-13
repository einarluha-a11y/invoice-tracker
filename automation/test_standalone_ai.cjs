const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');
require('dotenv').config();

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

async function standaloneAITest() {
    try {
        const tempPath = path.join(__dirname, 'Tele2_arve_01032026_15124857692_Invoice_04032026.pdf');

        if (!fs.existsSync(tempPath)) {
            console.error("PDF file not found!");
            return;
        }

        const pdfData = await pdfParse(fs.readFileSync(tempPath));
        const textToParse = pdfData.text.trim();
        const customRules = ""; // Assume no custom rules for this test, or paste them if needed

        console.log(`Passing ${textToParse.length} characters to OpenAI...`);

        const prompt = `
Extract the following invoice data into a PERFECT JSON object.
Company Name the invoice is sent to: Global Backend Default
CRITICAL RULE 1: If the 'Company Name' above appears as the VENDOR/Issuer, DO NOT USE IT. Find the actual external company that issued the bill.

INVOICE TEXT:
${textToParse}
        `;

        const completion = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            temperature: 0,
            max_tokens: 1000,
            system: "You are a professional accounting data extractor. Output ONLY valid JSON, with keys: vendorName, invoiceId, amount (number), dateCreated (YYYY-MM-DD), dueDate (YYYY-MM-DD), description (string, max 3 words).",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const rawJsonStr = completion.content[0].text;
        console.log("\n---- AI JSON OUTPUT ----");
        console.log(rawJsonStr);

    } catch (e) {
        console.error("AI Error:", e.message);
    }
}
standaloneAITest();
