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
        console.log(`Connecting to ${config.imap.user}...`);
        const connection = await imaps.connect(config);
        const box = await connection.openBox('INBOX');

        const searchCriteria = [
            ['SINCE', 'March 8, 2026']
        ];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'] };
        const messages = await connection.search(searchCriteria, fetchOptions);

        console.log(`Found ${messages.length} messages since March 8.`);
        messages.forEach(item => {
            const header = item.parts.find(a => a.which === 'HEADER');
            const subject = header.body.subject ? header.body.subject[0] : 'No Subject';
            const from = header.body.from ? header.body.from[0] : 'Unknown';
            const date = header.body.date ? header.body.date[0] : 'Unknown';

            if (subject.toLowerCase().includes('result') || from.toLowerCase().includes('result')) {
                console.log(`\n[MATCH FOUND]`);
                console.log(`  From: ${from}`);
                console.log(`  Subject: ${subject}`);
                console.log(`  Date: ${date}`);
                console.log(`  UID: ${item.attributes.uid}`);
            }
        });

        console.log('\nSearch complete.');
        connection.end();
    } catch (e) {
        console.error('Error:', e);
    }
}

run();
