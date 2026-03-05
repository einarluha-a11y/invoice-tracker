const ImapClient = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
require('dotenv').config();

const config = {
    imap: { user: 'invoices@gltechnics.com', password: process.env.IMAP_PASSWORD || 'Oleg2003$', host: 'imap.zone.eu', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 }
};

async function test() {
    const connection = await ImapClient.connect(config);
    await connection.openBox('INBOX');
    const results = await connection.search([['UID', '187']], { bodies: [''], struct: true, markSeen: false });
    const parsed = await simpleParser(results[0].parts.find(p => p.which === '').body);
    
    for (const attachment of parsed.attachments) {
        console.log(`Content-Type: ${attachment.contentType}, Filename: ${attachment.filename}`);
        try {
            const filename = attachment.filename.toLowerCase();
        } catch(e) {
            console.log("CRASHED ON THIS ATTACHMENT:", e.message);
        }
    }
    connection.end();
}
test();
