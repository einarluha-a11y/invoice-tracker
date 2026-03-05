const ImapClient = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
require('dotenv').config();

const config = {
    imap: { user: 'invoices@gltechnics.com', password: process.env.IMAP_PASSWORD || 'Oleg2003$', host: 'imap.zone.eu', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 }
};

async function check() {
    try {
        const connection = await ImapClient.connect(config);
        await connection.openBox('INBOX');
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: [''], markSeen: false };
        const results = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`Found ${results.length} UNSEEN emails today.`);
        for (const res of results) {
             const all = res.parts.find(p => p.which === '');
             const id = res.attributes.uid;
             const parsed = await simpleParser(all.body);
             console.log(`- UNSEEN: [${id}] ${parsed.subject} | Attachments: ${parsed.attachments.length}`);
        }
        
        const resultsAll = await connection.search(['ALL', ['SINCE', 'March 05, 2026']], fetchOptions);
        console.log(`\nFound ${resultsAll.length} TOTAL emails since today.`);
        for (const res of resultsAll) {
             const all = res.parts.find(p => p.which === '');
             const id = res.attributes.uid;
             const parsed = await simpleParser(all.body);
             console.log(`- TOTAL: [${id}] ${parsed.subject} | Attachments: ${parsed.attachments.length} | Has PDF: ${parsed.attachments.some(a => a.contentType === 'application/pdf')}`);
        }
        
        connection.end();
    } catch(e){
        console.error("Error", e.message);
    }
}
check();
