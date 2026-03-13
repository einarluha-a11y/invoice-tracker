const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');
const OpenAI = require('@anthropic-ai/sdk');
require('dotenv').config();

const openai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const configs = [
    {
        name: 'Global Technics OÜ',
        uid: 194,
        config: {
            user: 'invoices@gltechnics.com',
            password: 'p5(m(q4@#54XQ]V',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    },
    {
        name: 'Ideacom OÜ',
        uid: 83,
        config: {
            user: 'invoices@ideacom.ee',
            password: '9d2EB2!cZ79Z9jp',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    }
];

// Standalone AI extraction function mimicking the updated index.js logic
async function parseInvoiceDataWithAI_Standalone(rawText, companyName) {
    console.log(`[AI] Parsing raw data with OpenAI for company: ${companyName}...`);

    const prompt = `
You are an expert accountant system. 
Extract ALL invoices from the provided raw text (often a messy CSV, PDF report, or email body).
Return EXACTLY a JSON array of invoice objects with NO markdown wrapping, NO extra text.
Even if there is only one invoice, return it as an ARRAY containing that single object.

CRITICAL RULE FOR VENDOR NAME:
The company "${companyName}" (and any variations) AND "GLOBAL TECHNICS OÜ" are ALWAYS the BUYER/CUSTOMER. 
They are NEVER the vendor/seller. 
You must find the ACTUAL company that issued the invoice to ${companyName} (e.g., look for "Müüja", "Saatja", "Tarnija", "Bill From", or the company logo text). 
CRITICAL ENGLISH INVOICE RULE: If you see "Bill To", the company listed under it is the BUYER. If you see "Recipient" alongside bank details (IBAN/Account), that company is the VENDOR receiving the money. 
If an invoice is issued by "FS Teenused OÜ" to "${companyName}", the vendorName MUST be "FS Teenused OÜ".

CRITICAL RULE FOR REJECTING NON-INVOICE DOCUMENTS:
If the document is strictly an Insurance Policy (Poliis, Kindlustuspoliis), Contract (Leping), or has NO clear amount to pay, return an empty array [].
Otherwise, if it contains a vendor, date, and amount, ALWAYS extract the invoice. Do not falsely reject valid invoices just because the text is messy.

Required fields for EACH invoice object:
- invoiceId: (e.g. Inv-006, Dok. nr. CRITICAL: NEVER use a generic string like "Arve nr." or "Invoice". It MUST be the actual unique alphanumeric number next to it)
- vendorName: (The EXACT company issuing the invoice, NEVER ${companyName} and NEVER GLOBAL TECHNICS OÜ)
- amount: (Number only. Final total amount for the current period, EXCLUDING past debt)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format. CRITICAL: Provide the actual issuing date, not the print/export date)
- dueDate: (DD-MM-YYYY format. If no explicit due date, use dateCreated)
- description: (String, max 3-4 words. Guess based on vendor if not explicit)

Raw Data:
${rawText}
`;
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('[AI Error]', error);
        return null; 
    }
}

async function runTest() {
    for (const item of configs) {
        console.log(`\n\n--- Testing ${item.name} UID: ${item.uid} ---`);
        try {
            const connection = await imaps.connect({ imap: item.config });
            await connection.openBox('INBOX');

            const searchCriteria = [['UID', item.uid]];
            const fetchOptions = { bodies: [''] };
            const messages = await connection.search(searchCriteria, fetchOptions);

            if (!messages.length) {
                console.log('Message not found.');
                connection.end();
                continue;
            }

            const email = messages[0];
            const all = email.parts.find(a => a.which === '');
            const parsedEmail = await simpleParser(all.body);

            let hasAttachment = false;
            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                        hasAttachment = true;
                        console.log(`Extracting text from PDF attachment: ${attachment.filename}...`);
                        const pdfData = await pdfParse(attachment.content);
                        const rawContent = pdfData.text;
                        
                        console.log('Sending to AI...');
                        const result = await parseInvoiceDataWithAI_Standalone(rawContent, item.name);
                        console.log('AI Result:', JSON.stringify(result, null, 2));
                    }
                }
            }
            if (!hasAttachment) {
                console.log('No PDF attachment found.');
            }
            
            connection.end();
        } catch (e) {
            console.error(e);
        }
    }
    process.exit(0);
}

runTest();
