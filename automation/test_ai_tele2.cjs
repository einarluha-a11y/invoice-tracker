const { parseInvoiceDataWithAI } = require('./index.js');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');

async function testAI() {
    try {
        const tempPath = path.join(__dirname, 'Tele2_arve_01032026_15124857692_Invoice_04032026.pdf');
        const pdfData = await pdfParse(fs.readFileSync(tempPath));
        const text = pdfData.text.trim();
        console.log("Passing text to AI...");
        const result = await parseInvoiceDataWithAI(text, "Global Backend Default");
        console.log("---- AI JSON OUTPUT ----");
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("AI Error:", e);
    }
}
testAI();
