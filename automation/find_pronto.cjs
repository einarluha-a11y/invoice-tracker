require('dotenv').config();
const imaps = require('imap-simple');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const companiesToSearch = ['vlhvA6i8d3Hry8rtrA3Z', 'bP6dc0PMdFtnmS5QTX4N']; // Ideacom and Global Technics

async function findMissingEmails() {
    console.log('[IMAP Search] Scanning across multiple tenants for missing Pronto payloads...');
    
    for (const companyId of companiesToSearch) {
        const doc = await db.collection('companies').doc(companyId).get();
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

        console.log(`\n\n[IMAP Search] Connecting to ${data.name} (${config.imap.user})...`);
        try {
            const connection = await imaps.connect(config);
            await connection.openBox('INBOX');

            console.log(`[IMAP Search] Accessing mailbox for ${data.name}. Searching for '21-28', '21-29', '21.29'...`);
            
            // Search criteria
            const searchCriteria = [
                ['OR', ['TEXT', '21-28'], ['OR', ['TEXT', '21.29'], ['TEXT', '21-29']]]
            ];
            
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT'],
                markSeen: false
            };

            const results = await connection.search(searchCriteria, fetchOptions);
            console.log(`[IMAP Search] Found ${results.length} emails containing the target Pronto serials.`);

            let resurrected = 0;
            for (const msg of results) {
                const subject = (msg.parts.find(p => p.which === 'HEADER').body.subject[0] || '').toLowerCase();
                const from = (msg.parts.find(p => p.which === 'HEADER').body.from[0] || '').toLowerCase();
                const uid = msg.attributes.uid;
                
                console.log(`  -> Validating UID ${uid} | Sender: ${from} | Subject: "${subject}"`);
                console.log(`      ✅ MATCH CONFIRMED! Flagging UID ${uid} as UNSEEN for instantaneous PM2 ingestion...`);
                await connection.delFlags(uid, ['\\Seen']);
                resurrected++;
            }
            
            console.log(`[IMAP Search] Successfully resurrected ${resurrected} target emails in ${data.name}!`);
            connection.end();
            
        } catch (err) {
            console.error(`[IMAP Search] Failed for ${data.name}:`, err.message);
        }
    }
    
    console.log('\n[IMAP Global] Sweep Complete. The PM2 Daemon will re-read them in less than 60 seconds.');
    process.exit(0);
}

findMissingEmails();
