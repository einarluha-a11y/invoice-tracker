require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs');

const config = {
    imap: {
        user: process.env.IMAP_USER || 'invoices@gltechnics.com',
        password: process.env.IMAP_PASSWORD || 'M3vjFKRRJrz2Lhe',
        host: process.env.IMAP_HOST || 'imap.zone.eu',
        port: parseInt(process.env.IMAP_PORT || '993', 10),
        tls: process.env.IMAP_TLS === 'true',
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function run() {
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search([['UID', 191]], { bodies: [''], struct: true });

        for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            if (all && all.body) {
                const parsed = await simpleParser(all.body);
                console.log(`Subject: ${parsed.subject}`);
                console.log(`Attachments: ${parsed.attachments ? parsed.attachments.length : 0}`);

                if (parsed.attachments) {
                    parsed.attachments.forEach((att, idx) => {
                        console.log(`Attachment ${idx}:`);
                        console.log(`  Filename: ${att.filename}`);
                        console.log(`  ContentType: ${att.contentType}`);
                        console.log(`  Size: ${att.size}`);

                        fs.writeFileSync('result_group.pdf', att.content);
                        console.log('Saved as result_group.pdf locally.');
                    });
                }
            }
        }
        connection.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
