require('dotenv').config();
const fs = require('fs');
const https = require('https');
const pdfParse = require('pdf-parse');
const indexJs = require('./index.js'); // Use for parser test

const url = 'https://firebasestorage.googleapis.com/v0/b/invoice-tracker-xyz.firebasestorage.app/o/invoices%2FbP6dc0PMdFtnmS5QTX4N%2F1773427196780_260228_9.pdf?alt=media&token=06c763dd-ba3b-44eb-a2d3-5c86235bf1c0';

https.get(url, (res) => {
    let data = [];
    res.on('data', (chunk) => {
        data.push(chunk);
    });
    res.on('end', async () => {
        let buffer = Buffer.concat(data);
        fs.writeFileSync('test_result_group.pdf', buffer);
        console.log("Downloaded test_result_group.pdf");

        try {
            const pdfData = await pdfParse(buffer);
            const text = pdfData.text.replace(/\s+/g, ' ').trim();
            console.log("\n--- RAW PDF TEXT ---");
            console.log(text.substring(0, 1000)); // Print first 1000 chars

            console.log("\n--- RUNNING CLAUDE ON THIS TEXT ---");
            const parsed = await indexJs.parseInvoiceDataWithAI(text, "Global Technics OÜ");
            console.log("\nClaude Extracted Result:");
            console.log(JSON.stringify(parsed, null, 2));

        } catch (err) {
            console.error(err);
        }
    });
});
