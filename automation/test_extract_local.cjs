require("dotenv").config();
const fs = require('fs');
const imaps = require('imap-simple');
const admin = require('firebase-admin');
const { simpleParser } = require('mailparser');
const { fromBuffer } = require('pdf2pic');
const { OpenAI } = require('@anthropic-ai/sdk');

const openai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function parseInvoiceImageWithAI(base64Image, companyName = "Ideacom OÜ", customRules = "", mimeType = "image/png") {
    const promptText = `
You are an expert accountant system. 
Extract ALL invoices from the provided image (receipt, scanned document).
Return EXACTLY a JSON array of invoice objects with NO markdown wrapping, NO extra text.
Even if there is only one invoice, return it as an ARRAY containing that single object.

CRITICAL RULE FOR VENDOR NAME:
The company "${companyName}" (and any variations) AND "GLOBAL TECHNICS OÜ" are ALWAYS the BUYER/CUSTOMER. 
You must find the ACTUAL company that issued the invoice to ${companyName}.

CRITICAL RULE FOR REJECTING NON-INVOICE DOCUMENTS:
You must ONLY extract actual Invoices (Arve, Invoice, Счет), Credit Notes (Kreeditarve), or Receipts (Kviitung).
DO NOT extract Insurance Policies (Poliis, Kindlustuspoliis), Contracts (Leping), Certificates, or general letters.
If the document is a Policy or does not have a clear "amount to pay" for a service/good, return an empty array [].

CRITICAL RULE FOR AMOUNT:
DO NOT include past debt. Extract only the amount for the CURRENT billing period.
If it is a credit note, amount MUST be negative.
Estonian Translation Guide: "Tasuda", "Tasuda EUR", "Kulumishüvitis", or "Kokku" typically indicate the final Amount to pay.

CRITICAL RULE FOR DATES:
Convert ALL alphabetical month names into their exact 2-digit numerical equivalent.
Estonian Translation Guide: "Tähtaeg", "Maksetähtaeg", or "Maksetähtpäev" ALWAYS unequivocally mean DUE DATE.
If the Date is "Mar 6, 2026", dateCreated MUST be "06-03-2026".
If the Due Date is "Mar 8, 2026", dueDate MUST be "08-03-2026".

${customRules}
Required fields:
- invoiceId: (specific numeric/alphanumeric invoice number)
- vendorName: (The EXACT company issuing the invoice)
- amount: (Number only, decimal separated by dot)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format, issue date)
- dueDate: (DD-MM-YYYY format)
- description: (String, max 3-4 words)
`;

    const cleanBase64 = base64Image.startsWith('data:') ? base64Image.split(',')[1] : base64Image;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mimeType};base64,${cleanBase64}`
                        }
                    }
                ]
            }
        ],
        max_tokens: 1500,
        temperature: 0.1
    });

    const aiRes = response.choices[0].message.content.trim();
    let cleanedJson = aiRes;
    if (cleanedJson.startsWith("```json")) {
        cleanedJson = cleanedJson.replace(/```json/g, "").replace(/```/g, "").trim();
    }
    return JSON.parse(cleanedJson);
}

async function extractLocal() {
    const companies = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const companyId = companies.docs[0].id;
    const company = companies.docs[0].data();

    const config = {
        imap: {
            user: company.imapUser,
            password: company.imapPassword,
            host: company.imapHost.trim(),
            port: company.imapPort || 993,
            tls: true,
            authTimeout: 15000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    console.log("Connecting to IMAP...");
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');
    const messages = await connection.search([['UID', 76]], { bodies: [''], struct: true });

    let base64Data = null;
    let fileName = null;

    for (const item of messages) {
        const all = item.parts.find(part => part.which === '');
        if (all && all.body) {
            const parsed = await simpleParser(all.body);
            const attachments = parsed.attachments;
            if (attachments && attachments.length > 0) {
                const attachment = attachments[0];
                fileName = attachment.filename;
                console.log("Found attachment:", fileName);

                const pdfPath = '/tmp/temp_uid76.pdf';
                fs.writeFileSync(pdfPath, attachment.content);

                console.log("Converting PDF to image using Ghostscript/GraphicsMagick directly...");
                const { execSync } = require('child_process');
                const pngPath = '/tmp/temp_uid76_page1.png';

                try {
                    execSync(`/opt/homebrew/bin/gm convert -density 300 "${pdfPath}[0]" -quality 100 "${pngPath}"`);
                    base64Data = fs.readFileSync(pngPath, { encoding: 'base64' });
                } catch (e) {
                    console.error("Exec error:", e.message);
                    process.exit(1);
                }
            }
        }
    }
    connection.end();

    if (!base64Data) {
        console.log("No base64 data generated.");
        process.exit(1);
    }

    console.log("Parsing with local OpenAI...");
    const customRules = company.customAiRules || "";
    const parsedData = await parseInvoiceImageWithAI(base64Data, company.name, customRules);

    console.log("AI Parsed Result:", JSON.stringify(parsedData, null, 2));

    let addedCount = 0;
    for (const inv of parsedData) {
        if (!inv.invoiceId || !inv.vendorName) continue;

        inv.companyId = companyId;
        inv.status = inv.status || 'Pending';
        inv.createdAt = admin.firestore.FieldValue.serverTimestamp();

        // ensure amount is number
        if (typeof inv.amount === 'string') {
            inv.amount = parseFloat(inv.amount.replace(/[^0-9.-]+/g, ""));
        }

        await db.collection('invoices').add(inv);
        addedCount++;
    }

    console.log(`Saved ${addedCount} invoices reliably.`);
    process.exit(0);
}

extractLocal().catch(console.error);
