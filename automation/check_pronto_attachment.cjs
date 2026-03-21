const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkAttachments() {
    console.log('[IMAP Dissection] Fetching GT credentials from Firestore...');
    const doc = await db.collection('companies').doc('bP6dc0PMdFtnmS5QTX4N').get();
    const data = doc.data();

    const config = {
        imap: {
            user: data.imapUser,
            password: data.imapPassword,
            host: data.imapHost.trim(),
            port: data.imapPort || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 3000
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = [['OR', ['TEXT', '21-28'], ['OR', ['TEXT', '21.29'], ['TEXT', '21-29']]]];
        const fetchOptions = { bodies: [''], markSeen: false };

        console.log('[IMAP Dissection] Scanning GT for Pronto PL21-28 and PL21-29...');
        const results = await connection.search(searchCriteria, fetchOptions);

        for (const item of results) {
            const all = item.parts.find(a => a.which === '');
            const parsedEmail = await simpleParser(all.body);
            const subject = parsedEmail.subject || '';
            const uid = item.attributes.uid;

            if (subject.toLowerCase().includes('pronto') || subject.includes('21-28') || subject.includes('21.29') || subject.includes('21-29')) {
                console.log(`\n========================================`);
                console.log(`Email UID: ${uid}`);
                console.log(`Subject: "${subject}"`);
                console.log(`From: ${parsedEmail.from.value[0].address}`);
                
                if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                    console.log(`ATTACHMENTS FOUND (${parsedEmail.attachments.length}):`);
                    parsedEmail.attachments.forEach(att => {
                        console.log(`  -> ${att.filename} (${att.contentType})`);
                    });
                } else {
                    console.log(`ERROR: NO ATTACHMENTS FOUND IN THIS EMAIL!`);
                }
            }
        }

        connection.end();
        process.exit(0);
        
    } catch (err) {
        console.error('[IMAP Dissection] Failed:', err);
        process.exit(1);
    }
}

checkAttachments();
