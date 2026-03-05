const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function readNunnerRow() {
    console.log('Fetching the exact Jan/Feb CSV payment row for NUNNER...');

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

    const config = {
        imap: {
            user: imapUser, password: imapPassword, host: imapHost.trim(), port: imapPort || 993,
            tls: true, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        const messages = await connection.search(['ALL'], { bodies: [''] });

        for (const msg of messages) {
            const all = msg.parts.find(p => p.which === '');
            const parsedEmail = await simpleParser(all.body);

            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const att of parsedEmail.attachments) {
                    if (att.filename && att.filename === 'account-statement_01-Jan-2026_04-Mar-2026.csv') {
                        const csvText = att.content.toString('utf-8');
                        const lines = csvText.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            const l = lines[i].toLowerCase();
                            if (l.includes('nunner') || l.includes('4500') || l.includes('4221000525')) {
                                console.log("\n--- EXACT PAYMENT ROW MATCH ---");
                                console.log(lines[i]);
                            }
                        }
                    }
                }
            }
        }
        connection.end();
    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

readNunnerRow();
