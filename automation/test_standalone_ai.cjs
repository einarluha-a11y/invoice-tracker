const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
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

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "You are a professional accounting data extractor. Output ONLY valid JSON, with keys: vendorName, invoiceId, amount (number), dateCreated (YYYY-MM-DD), dueDate (YYYY-MM-DD), description (string, max 3 words)."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" }
        });

        const rawJsonStr = completion.choices[0].message.content;
        console.log("\n---- AI JSON OUTPUT ----");
        console.log(rawJsonStr);

    } catch (e) {
        console.error("AI Error:", e.message);
    }
}
standaloneAITest();
