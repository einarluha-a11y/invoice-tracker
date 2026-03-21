const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

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

        // The first email was UID 80
        const messages = await connection.search([['UID', 80]], { bodies: [''], struct: true });

        console.log(`Found message UID 80.`);
        for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            if (all && all.body) {
                const parsed = await simpleParser(all.body);
                console.log(`Subject: ${parsed.subject}`);
                console.log(`Date: ${parsed.date}`);
                console.log(`Attachments: ${parsed.attachments ? parsed.attachments.length : 0}`);

                if (parsed.attachments) {
                    parsed.attachments.forEach((att, idx) => {
                        console.log(`Attachment ${idx}:`);
                        console.log(`  Filename: ${att.filename}`);
                        console.log(`  ContentType: ${att.contentType}`);
                        console.log(`  Size: ${att.size}`);
                        console.log(`  ContentDisposition: ${att.contentDisposition}`);
                    });
                }
                console.log(`Text Body Length: ${parsed.text ? parsed.text.length : 0}`);
                // Print a small snippet of the text body to see what it is
                if (parsed.text) {
                    console.log(`Text Snippet: ${parsed.text.substring(0, 500)}`);
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
