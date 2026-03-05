const imaps = require('imap-simple');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function searchMailbox() {
    const companiesSnapshot = await db.collection('companies').get();
    let imapUser, imapPassword, imapHost, imapPort;

    companiesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.name.toUpperCase().includes('IDEACOM')) {
            imapUser = data.imapUser;
            imapPassword = data.imapPassword;
            imapHost = data.imapHost;
            imapPort = data.imapPort;
        }
    });

    console.log(`Searching mailbox ${imapUser} for Cargo Solutions...`);

    const config = {
        imap: {
            user: imapUser,
            password: imapPassword,
            host: imapHost.trim(),
            port: imapPort || 993,
            tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Search ALL emails for text 'Cargo Solutions'
        const searchCriteria = ['ALL', ['BODY', 'Cargo Solutions']];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true };

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} emails containing 'Cargo Solutions'.`);

        messages.forEach(msg => {
            const header = msg.parts.find(p => p.which === 'HEADER').body;
            console.log(`\nSubject: ${header.subject && header.subject[0]}`);
            console.log(`Date: ${header.date && header.date[0]}`);

            // Check attachments
            const parts = imaps.getParts(msg.attributes.struct);
            const attachments = parts.filter(part => part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT');
            console.log(`Attachments found: ${attachments.length}`);
            attachments.forEach(att => console.log(` - ${att.params.name}`));
        });

        connection.end();
    } catch (err) {
        console.error("IMAP Error:", err);
    }
}

searchMailbox();
