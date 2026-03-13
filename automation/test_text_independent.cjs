require('dotenv').config();
const OpenAI = require('@anthropic-ai/sdk');
const openai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function test() {
    const rawData = `Account details: 10220202582222, AS SEB Pank,
Tornimäe 2, Tallinn, 15010, Estonia
BIC - EEUHEE2X, IBAN - EE581010220202582222
Page 1 of 1
260228.928.02.2026
12875353
KMKR:EE101841061 
19.03.2026
CH / 6305321900 / 16.02.202610,00 EUR    110,00 EUR
CH / 54072011 / 17.02.2026
5,00 EUR    1
5,00 EUR
215,00 EUR
3,60 EUR
18,60 EUR
Kaheksateist euro 60 centi
Result Group OÜ
Reg. Nr.: 12208504, EORI: EE12208504
VAT number: EE101506238
Address: Paasiku 16-14, Tallinn, 13916, Estonia
Tel.: (+372) 582 82 717
E-mail: info.result.group@gmail.com
Arve nr.:
Maksja:Global Technics OÜ
Aadress:Harju maakond, Tallinn, Kesklinna linnaosa, Narva mnt 5, 10117, Eesti
Reg. nr.:
Maksetähtaeg:
Teenuse nimetus
Ühik   Ühiku hind
Kogus
Summa
Päringud (tolliinfo):
tk
tk
Kokku:
Käibemaks (24%)
Summa kokku:
Summa sõnadega:
Arve väljastas:
Vadim Jermolajev
Juhatuse liige`;

    const promptText = `
You are an expert accountant system. 
Extract ALL invoices from the provided text.
Return EXACTLY a JSON array of invoice objects with NO markdown wrapping, NO extra text.
Even if there is only one invoice, return it as an ARRAY containing that single object.

CRITICAL RULE FOR VENDOR NAME:
The company "GLOBAL TECHNICS OÜ" (and any variations) AND "GLOBAL TECHNICS OÜ" are ALWAYS the BUYER/CUSTOMER. 
You must find the ACTUAL company that issued the invoice to GLOBAL TECHNICS OÜ.

CRITICAL RULE: This is definitely an invoice. Do not reject it. Extract the fields.

CRITICAL RULE FOR AMOUNT:
DO NOT include past debt. Extract only the amount for the CURRENT billing period.
If it is a credit note, amount MUST be negative.

CRITICAL RULE FOR DATES:
Convert ALL alphabetical month names into their exact 2-digit numerical equivalent.
If there is NO explicit Due Date (maksetähtaeg) on the invoice, you MUST set the dueDate to be exactly the same as the dateCreated.

Required fields:
- invoiceId: (specific numeric/alphanumeric invoice number)
- vendorName: (The EXACT company issuing the invoice)
- amount: (Number only, decimal separated by dot)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format, issue date)
- dueDate: (DD-MM-YYYY format)
- description: (String, max 3-4 words)
`;

    console.log("Testing text with AI...");
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    { type: "text", text: rawData }
                ]
            }
        ],
        temperature: 0.1,
    });

    const jsonString = response.choices[0].message.content.trim();
    console.log(jsonString);
    process.exit(0);
}
test();
