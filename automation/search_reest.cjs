const admin = require('firebase-admin');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function searchAllInboxes() {
    console.log('Searching all companies for Re-Est today...');
    const snapshot = await db.collection('companies').get();

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.imapHost && data.imapUser && data.imapPassword) {
            console.log(`\n\n--- Checking ${data.name} (${data.imapUser}) ---`);
            const config = {
                imap: {
                    user: data.imapUser,
                    password: data.imapPassword,
                    host: data.imapHost.trim(),
                    port: data.imapPort || 993,
                    tls: true,
                    authTimeout: 30000,
                    connTimeout: 30000,
                    tlsOptions: { rejectUnauthorized: false }
                }
            };

            try {
                const connection = await imaps.connect(config);
                await connection.openBox('INBOX');

                // Search for ON today
                const date = new Date();
                const searchCriteria = [
                    ['SINCE', date.toISOString().split('T')[0]]
                ];

                const fetchOptions = { bodies: ['HEADER', ''], struct: true };
                const messages = await connection.search(searchCriteria, fetchOptions);

                console.log(`Found ${messages.length} messages since start of today.`);
                for (const item of messages) {
                    const header = item.parts.find(a => a.which === 'HEADER');
                    const subject = header.body.subject[0] || '';
                    if (subject.toLowerCase().includes('re-est') || subject.toLowerCase().includes('invoice') || subject.toLowerCase().includes('arve') || subject.toLowerCase().includes('arveldus')) {
                         console.log(`  -> UID: ${item.attributes.uid} | Subject: ${subject} | Date: ${header.body.date[0]}`);
                         
                         // fetch attachments if it's re-est
                         if (subject.toLowerCase().includes('re-est')) {
                             const all = item.parts.find(a => a.which === '');
                             const parsedEmail = await simpleParser(all.body);
                             console.log(`     Attachments: ${parsedEmail.attachments ? parsedEmail.attachments.map(a => a.filename).join(', ') : 'none'}`);
                         }
                    }
                }
                connection.end();
            } catch (e) {
                console.error(`Failed to connect to ${data.name}:`, e.message);
            }
        }
    }
    process.exit(0);
}

searchAllInboxes();
