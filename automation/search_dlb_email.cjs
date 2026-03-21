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
            ['OR', ['BODY', 'DLB'], ['BODY', '4854546']]
        ];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'] };

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} messages.`);
        
        for (const item of messages) {
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log("Subject:", header.body.subject[0]);
            console.log("Date:", header.body.date[0]);
            console.log("Message Attributes:", item.attributes.struct);
        }
        
        connection.end();
    } catch(e) {
        console.error(e);
    }
}

run();
