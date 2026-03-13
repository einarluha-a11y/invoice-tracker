const { parseInvoiceDataWithAI } = require('./index.js');

async function test() {
    const rawContent = `
DeepL SE, Maarweg 165, 50825 Cologne, Germany
VAT Reg # : DE349242045

INVOICE
Invoice # DI-20260309-6932
Invoice Date 09.03.2026 18:41 UTC
Invoice Amount € 29,99 (EUR)
Customer ID
BTcYCMULWR1Le9YKR
Payment Terms Due Upon Receipt
ОПЛАЧЕН

BILLED TO
Einar Luha
Global Technics OU

Total € 29,99
Payments -€ 29,99
Amount Due (EUR) € 0,00
`;
    console.log("Testing parseInvoiceDataWithAI...");
    const parsed = await parseInvoiceDataWithAI(rawContent, "Global Technics OU");
    console.log(JSON.stringify(parsed, null, 2));
}

test().catch(console.error).finally(() => process.exit(0));
