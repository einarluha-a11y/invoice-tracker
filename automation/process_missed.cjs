const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { parseInvoiceDataWithAI, writeToFirestore, parseInvoiceImageWithAI } = require('./index_local.js');
const pdfParse = require('pdf-parse');

// Workaround for port conflict: load index_local which does not start the webserver
const configs = [
    {
        name: 'Global Technics OÜ',
        companyId: 'gC4v8Lp1', // Placeholder, needs actual ID, we'll use a hack to bypass this if needed
        uid: 194,
        config: {
            user: 'invoices@gltechnics.com',
            password: 'p5(m(q4@#54XQ]V',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    },
    {
        name: 'Ideacom OÜ',
        companyId: 'bP6dc0PMdFtnmS5QTX4N', // Usually bP...
        uid: 83,
        config: {
            user: 'invoices@ideacom.ee',
            password: '9d2EB2!cZ79Z9jp',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    }
];

// Instead of writing to db right away, we use the actual test_process index which uses process.env port and lets us exit
// We will just use the new test script but copy the index.js logic locally to avoid port 3000

const fs = require('fs');
let localIndexJs = fs.readFileSync('./index.js', 'utf8');
localIndexJs = localIndexJs.replace(/const PORT = process\.env\.PORT \|\| 3000;/g, 'const PORT = process.env.PORT || 3001;');
fs.writeFileSync('./index_local.js', localIndexJs);

const localApp = require('./index_local.js');

async function processMissed() {
    for (const item of [configs[1]]) { // Only testing Ideacom right now since GT password failed
        console.log(`\n\n--- Processing ${item.name} UID: ${item.uid} ---`);
        try {
            const connection = await imaps.connect({ imap: item.config });
            await connection.openBox('INBOX');

            const searchCriteria = [['UID', item.uid]];
            const fetchOptions = { bodies: [''] };
            const messages = await connection.search(searchCriteria, fetchOptions);

            const email = messages[0];
            const all = email.parts.find(a => a.which === '');
            const parsedEmail = await simpleParser(all.body);

            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                        console.log(`Extracting text from PDF attachment: ${attachment.filename}...`);
                        const pdfData = await pdfParse(attachment.content);
                        const rawContent = pdfData.text;
                        
                        console.log('Sending to AI...');
                        const parsedData = await localApp.parseInvoiceDataWithAI(rawContent, item.name, "");
                        console.log('AI Result:', JSON.stringify(parsedData, null, 2));

                        if (parsedData && parsedData.length > 0) {
                            // Assign company ID manually
                            parsedData.forEach(i => i.companyId = "bP6dc0PMdFtnmS5QTX4N");
                            
                            // Mocking fileUrl to avoid Firebase storage upload for this force script, 
                            // Zapier will handle it gracefully or we can add it later
                            parsedData.forEach(i => i.fileUrl = null);

                            console.log('Writing to Firestore (and triggering Zapier)...');
                            await localApp.writeToFirestore(parsedData);
                            console.log('Done!');
                        }
                    }
                }
            }
            connection.end();
        } catch (e) {
            console.error(e);
        }
    }
    setTimeout(() => process.exit(0), 5000); // Give firestore time to resolve
}

processMissed();
