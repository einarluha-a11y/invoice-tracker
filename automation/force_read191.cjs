require('dotenv').config();
const imaps = require('imap-simple');

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

        console.log(`Removing \\Seen flag from UID 191...`);
        await connection.delFlags(191, ['\\Seen']);
        console.log(`Done! The background poller will now pick it up within 30 seconds.`);

        connection.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
