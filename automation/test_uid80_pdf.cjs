const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');

const config = {
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

async function run() {
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search([['UID', 80]], { bodies: [''], struct: true });
        const item = messages[0];
        const all = item.parts.find(part => part.which === '');
        const parsedEmail = await simpleParser(all.body);

        const attachment = parsedEmail.attachments[0];
        console.log(`Attachment found: ${attachment.filename}`);

        try {
            console.log('[PDF] Parsing PDF data...');
            const pdfData = await pdfParse(attachment.content);
            const rawContent = pdfData.text;
            console.log(`Extracted text length: ${rawContent.length}`);
            console.log(`Extracted snippet: ${rawContent.trim().substring(0, 100)}...`);

            if (rawContent.trim().length < 10) {
                console.log(`[PDF] Extracted text is empty (likely a scanned image).`);
            }
        } catch (e) {
            console.error(`[PDF Extraction Error]`, e);
            const fallbackBody = (parsedEmail.text || parsedEmail.html || '').trim();
            console.log(`Fallback body length: ${fallbackBody.length}`);
        }

        connection.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
