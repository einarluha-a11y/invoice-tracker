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

        // Fetch last message
        const totalMessages = box.messages.total;
        const fetchOptions = { bodies: ['HEADER'] };
        const messages = await connection.search([`${totalMessages}`], fetchOptions);

        console.log(`Found last message UID: ${messages[0].attributes.uid}`);
        console.log(`Subject: ${messages[0].parts[0].body.subject[0]}`);

        // Remove \Seen flag
        await connection.delFlags(messages[0].attributes.uid, ['\\Seen']);
        console.log(`Marked as UNSEEN. Proceeding to poll...`);
        connection.end();

        // Trigger index.js processing
        console.log("Triggering index.js manual poll...");
        const { pollAllCompanyInboxes } = require('./index');
        await pollAllCompanyInboxes();
        console.log("Poll complete. Exiting.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
