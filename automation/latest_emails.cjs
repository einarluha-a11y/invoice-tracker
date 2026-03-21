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
        const box = await connection.openBox('INBOX');

        // Fetch last 3 messages
        const totalMessages = box.messages.total;
        const fetchStart = Math.max(1, totalMessages - 2);

        const fetchOptions = { bodies: ['HEADER'] };
        const messages = await connection.search([`${fetchStart}:*`], fetchOptions);

        console.log(`Found ${messages.length} recent messages.`);
        messages.forEach(item => {
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log(`- Subject: ${header.body.subject[0]}`);
            console.log(`  Date: ${header.body.date[0]}`);
        });

        connection.end();
    } catch (e) {
        console.error(e);
    }
}

run();
