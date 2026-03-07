const imaps = require('imap-simple');
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function requeue() {
    const targetUID = 79;

    const snapshot = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    if (snapshot.empty) return;
    const company = snapshot.docs[0].data();

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
        console.log(`Connecting...`);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        console.log(`Marking UID ${targetUID} as UNSEEN...`);

        await connection.delFlags(targetUID, ['\\Seen']);
        console.log("Done.");

        connection.end();
        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

requeue();
