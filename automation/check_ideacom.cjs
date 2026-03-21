const imaps = require('imap-simple');

const configIC = {
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

async function checkIdeacomInbox() {
    console.log("Checking connection to invoices@ideacom.ee...");
    try {
        const connection = await imaps.connect(configIC);
        console.log("✅ Successfully connected to Ideacom IMAP server!");
        
        await connection.openBox('INBOX');
        console.log("✅ Successfully opened INBOX!");

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER'], struct: true };
        
        console.log("Searching for UNSEEN messages...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`\n📬 Found ${messages.length} UNREAD messages.`);
        
        for (const item of messages) {
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log(`- UID: ${item.attributes.uid} | Subject: "${header.body.subject[0]}" | Date: ${header.body.date[0]}`);
        }

        connection.end();
        console.log("\nConnection closed safely.");
    } catch (e) {
        console.error("❌ Failed to connect to Ideacom:", e.message);
    }
}

checkIdeacomInbox();
