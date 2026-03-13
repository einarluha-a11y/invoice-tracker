const { parseInvoiceDataWithAI } = require('./index.js');
const fs = require('fs');

async function testAI() {
    const rawText = fs.readFileSync('./lhv_test.txt', 'utf8');
    console.log("Testing AI text extraction on LHV PDF...");
    const parsedData = await parseInvoiceDataWithAI(rawText, "Ideacom OÜ", "");
    console.log("Result:", JSON.stringify(parsedData, null, 2));
    process.exit(0);
}

testAI();
