const imaps = require('imap-simple');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function markUnread() {
    console.log('Fetching Ideacom OÜ credentials...');
    const companiesSnapshot = await db.collection('companies').get();

    for (const doc of companiesSnapshot.docs) {
        const data = doc.data();
        if (data.name && data.name.toUpperCase().includes('IDEACOM') && data.imapUser) {
            console.log(`Logging into IMAP for ${data.name}...`);
            const config = {
                imap: {
                    user: data.imapUser,
                    password: data.imapPassword,
                    host: data.imapHost.trim(),
                    port: data.imapPort || 993,
                    tls: true,
                    authTimeout: 10000,
                    tlsOptions: { rejectUnauthorized: false }
                }
            };

            try {
                const connection = await imaps.connect(config);
                await connection.openBox('INBOX');

                // Search for ALL currently "read" messages so we can revert them to "unread"
                const searchCriteria = ['SEEN'];
                const fetchOptions = { bodies: ['HEADER'], struct: true };

                const messages = await connection.search(searchCriteria, fetchOptions);
                console.log(`Found ${messages.length} previously read emails.`);

                if (messages.length > 0) {
                    console.log(`Marking all ${messages.length} emails as UNSEEN so the AI rescans them...`);
                    for (const message of messages) {
                        const uid = message.attributes.uid;
                        // For imap-simple, we can use delFlags to remove the Read status
                        await connection.delFlags(uid, ['\\Seen']);
                    }
                    console.log('Successfully marked emails as UNSEEN!');
                } else {
                    console.log('No read emails found.');
                }

                connection.end();
            } catch (err) {
                console.error("IMAP Error:", err);
            }
        }
    }

    process.exit(0);
}

markUnread();
