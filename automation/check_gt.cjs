const imaps = require('imap-simple');

const configGT = {
    imap: {
        user: 'invoices@gltechnics.com',
        password: 'p5(m(q4@#54XQ]V',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function checkGlobalTechnicsInbox() {
    console.log("Checking connection to invoices@gltechnics.com...");
    try {
        const connection = await imaps.connect(configGT);
        console.log("✅ Successfully connected to Global Technics IMAP server!");
        
        await connection.openBox('INBOX');
        console.log("✅ Successfully opened INBOX!");

        // Search for UNSEEN OR anything from the past 24 hours just in case
        const today = new Date();
        const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        
        const searchCriteria = [['SINCE', yesterday]];
        const fetchOptions = { bodies: ['HEADER'] };
        
        console.log("Searching for RECENT messages...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`\n📬 Found ${messages.length} recent messages.`);
        
        for (const item of messages.slice(-5)) { // Just show the last 5
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log(`- UID: ${item.attributes.uid} | Subject: "${header.body.subject[0]}" | Date: ${header.body.date[0]}`);
        }

        connection.end();
        console.log("\nConnection closed safely.");
    } catch (e) {
        console.error("❌ Failed to connect to Global Technics:", e.message);
    }
}

checkGlobalTechnicsInbox();
