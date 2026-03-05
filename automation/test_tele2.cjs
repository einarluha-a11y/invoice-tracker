const ImapClient = require('imap-simple');

const config = {
    imap: { user: 'invoices@gltechnics.com', password: process.env.IMAP_PASSWORD || 'Oleg2003$', host: 'imap.zone.eu', port: 993, tls: true, authTimeout: 3000 }
};

async function check() {
    try {
        const connection = await ImapClient.connect(config);
        await connection.openBox('INBOX');
        const results = await connection.search(['ALL', ['SINCE', new Date('2026-03-05T00:00:00Z')]], { bodies: ['HEADER', 'TEXT'] });
        console.log(`Found ${results.length} total emails since today.`);
        for (const res of results) {
             const header = res.parts.find(p => p.which === 'HEADER').body;
             console.log(`- Date: ${header.date[0]} | From: ${header.from[0]} | Subject: ${header.subject[0]}`);
        }
        connection.end();
    } catch(e){
        console.error(e);
    }
}
check();
