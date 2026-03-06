const imaps = require('imap-simple');
const admin = require('firebase-admin');
const fs = require('fs');
const { simpleParser } = require('mailparser');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function readUid76() {
    const companies = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const company = companies.docs[0].data();

    const config = {
        imap: {
            user: company.imapUser,
            password: company.imapPassword,
            host: company.imapHost.trim(),
            port: company.imapPort || 993,
            tls: true,
            authTimeout: 15000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        const messages = await connection.search([['UID', 76]], { bodies: [''], struct: true });

        for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            if (all && all.body) {
                const parsed = await simpleParser(all.body);
                console.log("Subject:", parsed.subject);
                console.log("Text:", parsed.text);
            }
        }
        connection.end();
        process.exit(0);

    } catch (err) {
        console.error("IMAP Error:", err);
        process.exit(1);
    }
}
readUid76();
