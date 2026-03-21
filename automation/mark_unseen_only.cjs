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

        const totalMessages = box.messages.total;
        const fetchOptions = { bodies: ['HEADER'] };
        const messages = await connection.search([`${totalMessages}`], fetchOptions);
        
        const uid = messages[0].attributes.uid;
        console.log(`Found last message UID: ${uid}`);
        console.log(`Subject: ${messages[0].parts[0].body.subject[0]}`);

        await connection.delFlags(uid, ['\\Seen']);
        console.log(`Marked as UNSEEN.`);
        connection.end();
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}

run();
