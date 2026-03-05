const imaps = require('imap-simple');

async function checkEmails() {
    const config = {
        imap: {
            user: 'invoices@gltechnics.com',
            password: 'M3vjFKRRJrz2Lhe',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        console.log('Connecting...');
        const connection = await imaps.connect(config);
        
        console.log('Opening box...');
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true };

        console.log('Searching...');
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`Found ${messages.length} UNSEEN messages.`);
        messages.forEach(msg => {
             console.log(msg.parts[0].body);
        });

        connection.end();
        console.log('Done.');
    } catch (err) {
        console.log('Err:', err);
    }
}
checkEmails();
