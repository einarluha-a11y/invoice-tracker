const Imap = require('imap-simple');
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
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

        const searchCriteria = ['ALL'];
        const fetchOptions = { bodies: ['HEADER'], markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        let targetUid = null;
        // Search last 50 for FFC text in subject
        for (const item of messages.slice(-50)) {
            const headerPart = item.parts.filter(p => p.which === 'HEADER')[0];
            const subject = headerPart.body.subject ? headerPart.body.subject[0].toLowerCase() : '';
            if (subject.includes('урал')) {
                targetUid = item.attributes.uid;
                console.log(`Found FFC email. UID: ${targetUid}`);
                break;
            }
        }

        if (targetUid) {
            await connection.delFlags(targetUid, '\\Seen');
            console.log(`Successfully marked UID ${targetUid} as UNSEEN.`);
        } else {
            console.log("Could not find FFC email to mark unseen.");
        }

    } catch(e) {
        console.error(e);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}
run();
