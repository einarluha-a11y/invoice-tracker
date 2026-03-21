const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; 
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const config = {
        imap: {
            user: companyDoc.data().imapUser,
            password: companyDoc.data().imapPassword,
            host: companyDoc.data().imapHost.trim(),
            port: companyDoc.data().imapPort,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000
        }
    };

    let connection;
    try {
        connection = await Imap.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = ['ALL'];
        const fetchOptions = { bodies: [''], markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        const recentMessages = messages.slice(-50);

        console.log(`Checking last 50 emails for FFC LOGISTICS...`);
        let found = false;

        for (const item of recentMessages) {
            const all = item.parts.filter(part => part.which === '')[0];
            const parsed = await simpleParser(all.body);
            
            const subject = parsed.subject ? parsed.subject.toLowerCase() : '';
            const text = parsed.text ? parsed.text.toLowerCase() : '';
            const from = parsed.from ? parsed.from.text.toLowerCase() : '';

            if (subject.includes('ffc') || text.includes('ffc') || from.includes('ffc')) {
                found = true;
                console.log(`\n--- FOUND POTENTIAL FFC EMAIL ---`);
                console.log(`Subject: ${parsed.subject}`);
                console.log(`From: ${parsed.from.text}`);
                console.log(`Date: ${parsed.date}`);
                console.log(`Attachments: ${parsed.attachments.length}`);
                
                parsed.attachments.forEach(att => {
                    console.log(` - ${att.filename} (${att.contentType})`);
                });
            }
        }
        
        if (!found) console.log("No emails mentioning FFC found in the last 50 emails.");

    } catch (err) {
        console.error("Error:", err);
    } finally {
        if (connection) connection.end();
    }
}
check();
