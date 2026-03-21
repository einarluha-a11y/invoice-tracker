require('dotenv').config();
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { parseInvoiceDataWithAI } = require('./index.js');

async function testPdf(filename) {
    console.log(`\n\n=== Parsing ${filename} ===`);
    try {
        const dataBuffer = fs.readFileSync(filename);
        const pdfData = await pdfParse(dataBuffer);
        const text = pdfData.text.replace(/\s+/g, ' ').trim();
        
        console.log(`Extracted Text Length: ${text.length} chars (First 100: ${text.substring(0, 100)})`);
        
        const result = await parseInvoiceDataWithAI(text, "Ideacom OÜ", "");
        console.log(`\nClaude Exact Return for ${filename}:\n`, JSON.stringify(result, null, 2));
    } catch(err) {
        console.error(err);
    }
}

async function run() {
    await testPdf('test_Receipt-2451-9417.pdf');
    await testPdf('test_Invoice-6A8DCCA4-0002.pdf');
}
run();
