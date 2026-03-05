const imaps = require('imap-simple');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function markCargoUnread() {
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

        // Search specifically for Cargo Solutions
        const searchCriteria = ['SEEN', ['BODY', 'Cargo Solutions']];
        const fetchOptions = { bodies: ['HEADER'], struct: true };

        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length > 0) {
            console.log(`Marking ${messages.length} Cargo Solutions email(s) as UNSEEN so the AI rescans...`);
            for (const message of messages) {
                const uid = message.attributes.uid;
                await connection.delFlags(uid, ['\\Seen']);
            }
            console.log('Success!');
        } else {
            console.log('No read emails found matching Cargo Solutions.');
        }

        connection.end();
    } catch (err) {
        console.error("IMAP Error:", err);
    }

    process.exit(0);
}

markCargoUnread();
