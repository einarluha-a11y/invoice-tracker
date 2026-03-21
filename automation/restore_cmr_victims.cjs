require('dotenv').config();
const Imap = require('imap-simple');
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    console.log('[Recovery] 🚑 Starting IMAP Thread Recovery for Ideacom...');
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
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

        const searchCriteria = [
            ['SINCE', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()] // Last 60 days
        ];
        const fetchOptions = { bodies: ['HEADER'], struct: true, markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        let restoredCount = 0;
        for (const item of messages) {
            const headerPart = item.parts.find(p => p.which === 'HEADER');
            if (!headerPart) continue;
            
            const subject = headerPart.body.subject ? headerPart.body.subject[0].toLowerCase() : '';
            const from = headerPart.body.from ? headerPart.body.from[0].toLowerCase() : '';
            
            // Re-trigger TONGER
            if (from.includes('tonger') || subject.includes('tonger') || from.includes('tõnger')) {
                
                const targetUid = item.attributes.uid;
                console.log(`[Recovery] ♻️ Marking UID ${targetUid} as \\Unseen (From: ${from})`);
                await connection.delFlags(targetUid, '\\Seen');
                restoredCount++;
            }
        }

        console.log(`\n[Recovery] 🏁 Successfully placed ${restoredCount} original emails back into the processing queue.`);
        console.log(`[Recovery] The Vision Pipeline will intercept them, skip the CMRs, and upload the true Invoices.`);

    } catch(e) {
        console.error('[Recovery] Error:', e);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}
run();
