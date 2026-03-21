const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const imapConfig = {
    imap: {
        user: "invoices@gltechnics.com",
        password: "83Gl92tecH42!", 
        host: "imap.zone.eu",
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function check() {
    console.log(`Connecting to IMAP...`);
    const connection = await imaps.connect(imapConfig);
    console.log('Connected to zone! Opening INBOX.');
    await connection.openBox('INBOX');

    // Widen search to any messages from March 9th onwards, or containing DeepL
    const searchCriteria = [
        ['SINCE', 'March 8, 2026']
    ];
    const fetchOptions = { bodies: ['HEADER', ''], struct: true };

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`Found ${messages.length} recent emails.`);
    messages.sort((a, b) => b.attributes.date - a.attributes.date);

    for (const item of messages) {
        const headerPart = item.parts.find(a => a.which === 'HEADER');
        const subject = headerPart.body.subject[0] || '';
        const from = headerPart.body.from[0] || '';
        
        if (subject.toLowerCase().includes('deepl') || JSON.stringify(from).toLowerCase().includes('deepl')) {
            const all = item.parts.find(a => a.which === '');
            const id = item.attributes.uid;
            
            console.log(`\n--- FOUND DEEPL EMAIL (UID: ${id}) ---`);
            const parsedEmail = await simpleParser(all.body);
            console.log(`From: ${JSON.stringify(from)}`);
            console.log(`Subject: ${parsedEmail.subject}`);
            console.log(`Date: ${parsedEmail.date}`);
            console.log(`Attachments: ${parsedEmail.attachments.length}`);
            
            for (const att of parsedEmail.attachments) {
                console.log(`  - ${att.filename} (${att.contentType}) - ${att.size} bytes`);
            }
            break; // Stop after finding the first match
        }
    }
    connection.end();
}

check().catch(console.error).finally(() => process.exit(0));
