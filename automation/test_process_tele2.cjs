const ImapClient = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { parseInvoiceDataWithAI } = require('./index.js'); // We'll try to use the logic
require('dotenv').config();

const config = {
    imap: { user: 'invoices@gltechnics.com', password: process.env.IMAP_PASSWORD || 'Oleg2003$', host: 'imap.zone.eu', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 }
};

const pdfPaths = [];
const fs = require('fs');
const path = require('path');

async function extractPDFToTemp() {
    try {
        const connection = await ImapClient.connect(config);
        await connection.openBox('INBOX');
        const fetchOptions = { bodies: [''], struct: true, markSeen: false };
        const results = await connection.search(['ALL', ['SINCE', 'March 05, 2026']], fetchOptions);
        
        for (const res of results) {
             const all = res.parts.find(p => p.which === '');
             const parsed = await simpleParser(all.body);
             if (parsed.subject && parsed.subject.includes('Tele2')) {
                 console.log(`Processing TELE2 email: ${parsed.subject}`);
                 for (const att of parsed.attachments) {
                     if (att.contentType === 'application/pdf') {
                         const tempPath = path.join(__dirname, att.filename || 'tele2.pdf');
                         fs.writeFileSync(tempPath, att.content);
                         console.log(`Saved PDF to ${tempPath}`);
                         pdfPaths.push(tempPath);
                     }
                 }
             }
        }
        connection.end();
    } catch(e) {
        console.error("Error fetching", e);
    }
}
extractPDFToTemp();
