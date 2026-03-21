const imaps = require('imap-simple');

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

        const searchCriteria = [
            ['HEADER', 'SUBJECT', '4854546']
        ];

        let messages = await connection.search(searchCriteria, { bodies: ['HEADER'] });
        if (messages.length === 0) {
            messages = await connection.search([['BODY', '4854546']], { bodies: ['HEADER'] });
        }

        console.log(`Found ${messages.length} messages.`);

        for (const item of messages) {
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log("Subject:", header.body.subject[0]);
            console.log("Date:", header.body.date[0]);
            // Re-fetch struct for attachments
            const structFetch = await connection.search([['UID', item.attributes.uid]], { bodies: [''], struct: true });
            if (structFetch.length) {
                console.log("Struct:", JSON.stringify(structFetch[0].attributes.struct, null, 2));
            }
        }

        connection.end();
    } catch (e) {
        console.error(e);
    }
}

run();
