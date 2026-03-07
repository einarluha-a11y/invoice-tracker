const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const company = snapshot.docs[0].data();

    const config = {
        imap: {
            user: company.imapUser, password: company.imapPassword,
            host: company.imapHost.trim(), port: company.imapPort || 993,
            tls: true, tlsOptions: { rejectUnauthorized: false }
        }
    };
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    const searchCriteria = [['UID', '79']]; // The Ingeen email
    const fetchOptions = { bodies: [''], struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages.length > 0) {
        const item = messages[0];
        const all = item.parts.find(p => p.which === '');
        const parsed = await simpleParser(all.body);
        if (parsed.attachments.length > 0) {
            fs.writeFileSync('ingeen_test.pdf', parsed.attachments[0].content);
            console.log("Saved ingeen_test.pdf");
        }
    }
    connection.end();
}
run();
