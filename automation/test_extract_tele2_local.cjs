const ImapClient = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = {
    imap: {
        user: 'invoices@gltechnics.com',
        password: process.env.IMAP_PASSWORD || 'Oleg2003$',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 3000
    }
};

async function processUid187() {
    try {
        console.log("Connecting to IMAP...");
        const connection = await ImapClient.connect(config);
        await connection.openBox('INBOX');
        console.log("Fetching UID 187...");
        const fetchOptions = { bodies: [''], struct: true, markSeen: false };
        const results = await connection.search([['UID', '187']], fetchOptions);

        if (results.length === 0) {
            console.log("UID 187 not found!");
            process.exit(0);
        }

        const res = results[0];
        const all = res.parts.find(p => p.which === '');
        const parsed = await simpleParser(all.body);

        console.log(`Parsed email subject: ${parsed.subject}`);
        console.log(`Email has ${parsed.attachments.length} attachments.`);

        let pdfFound = false;
        for (const att of parsed.attachments) {
            if (att.contentType === 'application/pdf') {
                pdfFound = true;
                const tempPath = path.join(__dirname, att.filename || 'tele2.pdf');
                fs.writeFileSync(tempPath, att.content);
                console.log(`Saved ${att.filename} (${att.content.length} bytes) to disk.`);

                // Now let's try to parse the text
                try {
                    const pdfData = await pdfParse(att.content);
                    const text = pdfData.text.trim();
                    console.log(`\n--- Extracted PDF Text (${text.length} chars) ---`);
                    console.log(text.substring(0, 500) + (text.length > 500 ? '...\n(truncated)' : ''));
                    console.log(`-------------------------------------------------\n`);

                    if (text.length < 50) {
                        console.log("⚠️ PDF text extraction yielded very little text. It might be a scanned image.");
                    }
                } catch (pdfErr) {
                    console.error("❌ Failed to parse PDF text:", pdfErr.message);
                }
            }
        }

        if (!pdfFound) {
            console.log("No PDF attachment found in this email.");
        }

        connection.end();
        process.exit(0);
    } catch (e) {
        console.error("Main Error:", e.message);
        process.exit(1);
    }
}

processUid187();
