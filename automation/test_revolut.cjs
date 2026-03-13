const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('@anthropic-ai/sdk');
require('dotenv').config();

const openai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


async function parseBankStatementWithAI(rawText) {
    console.log('[AI] Parsing PDF Bank Statement with OpenAI...');

    const prompt = `
You are an expert accountant system parsing a bank account statement (e.g. from Revolut Business).
Extract ALL outgoing payment transactions (Expenses / Расходы).
Return EXACTLY a JSON array of transaction objects with NO markdown wrapping, NO extra text.

Required fields for EACH transaction object:
- description: (String. The name of the recipient/payee, e.g. "Google One", "Bolt", "Alexela AS", or payment description)
- reference: (String. Any invoice number or reference code mentioned in the payment details. Leave empty string if none)
- amount: (Number only, decimal separated by dot. MUST be a positive absolute number representing the expense amount, e.g. 10.00)

Ignore any incoming money (Прибыль), starting balances, and bank fees if they are labeled simply as 'Комиссия'. Focus on payments to vendors.

Raw Data:
${rawText}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();

        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('[AI Error] Failed to parse bank statement data:', error);
        return null;
    }
}

async function testPdf() {
  const imaps = require('imap-simple');

  const config = {
      imap: {
          user: 'invoices@gltechnics.com',
          password: 'M3vjFKRRJrz2Lhe',
          host: 'imap.zone.eu',
          port: 993,
          tls: true,
          authTimeout: 30000,
          tlsOptions: { rejectUnauthorized: false }
      }
  };

  const connection = await imaps.connect(config);
  await connection.openBox('INBOX');

  // get all emails
  const searchCriteria = ['ALL'];
  const fetchOptions = { bodies: [''], struct: true }; 

  const messages = await connection.search(searchCriteria, fetchOptions);
  console.log(`Checking last email out of ${messages.length}`);
  
  if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const simpleParser = require('mailparser').simpleParser;
      const all = lastMessage.parts.find(a => a.which === '');
      const parsedEmail = await simpleParser(all.body);
      
      if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
          const file = parsedEmail.attachments[0];
          console.log(`Found attachment: ${file.filename}`);
          
          if (file.filename.endsWith('.pdf')) {
              const pdfData = await pdfParse(file.content);
              const text = pdfData.text;
              console.log('--- Detected as Bank Statement! Testing AI Parser ---');
              const txs = await parseBankStatementWithAI(text);
              console.log(JSON.stringify(txs, null, 2));
              
          }
      }
  }
  
  connection.end();
  process.exit(0);
}

testPdf();
