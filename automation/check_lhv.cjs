const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');

const IDEACOM_CONFIG = {
    imap: {
        user: 'invoices@ideacom.ee',
        password: '9d2EB2!cZ79Z9jp',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function checkLHV() {
    console.log("Checking connection to invoices@ideacom.ee...");
    try {
        const connection = await imaps.connect(IDEACOM_CONFIG);
        await connection.openBox('INBOX');

        // Search for emails from today or yesterday
        const today = new Date();
        const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        
        const searchCriteria = [['SINCE', yesterday]];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };
        
        console.log("Searching for recent messages...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`Found ${messages.length} recent messages.`);
        
        for (const item of messages) {
            const header = item.parts.find(a => a.which === 'HEADER');
            const subject = header.body.subject[0];
            const from = header.body.from[0];
            
            if (subject.toLowerCase().includes('lhv') || from.toLowerCase().includes('lhv') || subject.toLowerCase().includes('kindlustus')) {
                console.log(`\n--- Found matching email! ---`);
                console.log(`Subject: ${subject}`);
                console.log(`From: ${from}`);
                console.log(`Date: ${header.body.date[0]}`);
                
                const all = item.parts.find(a => a.which === '');
                const parsedEmail = await simpleParser(all.body);

                if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                    for (const attachment of parsedEmail.attachments) {
                        if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                            console.log(`\nExtracting text from PDF: ${attachment.filename}...`);
                            try {
                                const pdfData = await pdfParse(attachment.content);
                                console.log('--- PDF TEXT START ---');
                                console.log(pdfData.text.substring(0, 1500)); // Print first 1500 chars
                                console.log('--- PDF TEXT END ---');
                                
                                // Save to file for further manual AI testing if needed
                                const fs = require('fs');
                                fs.writeFileSync('./lhv_test.txt', pdfData.text);
                                console.log('Saved full extracted text to lhv_test.txt');

                            } catch (err) {
                                console.error('Error parsing PDF:', err);
                            }
                        }
                    }
                } else {
                    console.log('No attachments found in this email.');
                }
            }
        }

        connection.end();
        console.log("\nDone checking.");
        process.exit(0);
    } catch (e) {
        console.error("Failed to connect or process:", e);
        process.exit(1);
    }
}

checkLHV();
