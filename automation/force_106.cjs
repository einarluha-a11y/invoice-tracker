const imaps = require('imap-simple');
var admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
    const doc = await db.collection('companies').doc('vlhvA6i8d3Hry8rtrA3Z').get();
    const data = doc.data();
    const config = {
        imap: { user: data.imapUser, password: data.imapPassword, host: data.imapHost.trim(), port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 }
    };
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');
    
    console.log('--- Forcefully removing SEEN flag from UID 106 ---');
    await connection.delFlags(106, ['\\Seen']);
    
    const results = await connection.search([['UID', '106']], { bodies: ['HEADER'], markSeen: false });
    if (results.length > 0) {
        const flags = results[0].attributes.flags;
        console.log('Current flags for UID 106:', flags);
    } else {
        console.log('UID 106 NOT FOUND!');
    }
    
    connection.end();
    process.exit(0);
}
check();
