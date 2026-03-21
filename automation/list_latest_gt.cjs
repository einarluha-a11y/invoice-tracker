const imaps = require('imap-simple');

const GT_CONFIG = {
    imap: {
        user: 'invoices@gltechnics.com',
        password: '83Gl92tecH42!',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function checkGLT() {
    console.log("Connecting to Global Technics inbox...");
    try {
        const connection = await imaps.connect(GT_CONFIG);
        await connection.openBox('INBOX');

        // Fetch the 5 most recent emails
        const searchCriteria = ['ALL'];
        const fetchOptions = { bodies: ['HEADER'], struct: true };
        
        console.log("Fetching recent emails...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`\nLast 5 emails in invoices@gltechnics.com:`);
        const recent = messages.slice(-5);
        for (const item of recent) {
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log(`- Date: ${header.body.date[0]}\n  From: ${header.body.from[0]}\n  Subject: ${header.body.subject[0]}\n`);
        }

        connection.end();
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

checkGLT();
