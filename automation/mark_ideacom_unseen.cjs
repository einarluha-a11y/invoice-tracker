require('dotenv').config();
const admin = require('firebase-admin');
const Imap = require('imap-simple');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function mark10IdeacomPdfsUnseen() {
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
    console.log(`[Test Trigger] 🎯 Connecting to Ideacom IMAP to stage 10 Verified PDF Invoices...`);
    
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const cData = companyDoc.data();
    
    const config = {
        imap: {
            user: cData.imapUser,
            password: cData.imapPassword,
            host: cData.imapHost.trim(),
            port: cData.imapPort,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000
        }
    };

    try {
        const connection = await Imap.connect(config);
        await connection.openBox('INBOX');

        // Fetch ALL emails with headers and structural metadata 
        const searchCriteria = ['ALL'];
        const fetchOptions = { bodies: ['HEADER'], struct: true };
        
        const results = await connection.search(searchCriteria, fetchOptions);
        
        const validEmails = [];
        for (let res of results) {
            // Check if ANY attachment is explicitly a PDF
            let hasPdf = false;
            if (res.attributes && res.attributes.struct) {
                const checkStruct = (str) => {
                    for (let part of str) {
                        if (Array.isArray(part)) {
                            checkStruct(part);
                        } else {
                            if (part.disposition && part.disposition.type && part.disposition.type.toUpperCase() === 'ATTACHMENT') {
                                if (part.disposition.params && part.disposition.params.filename && part.disposition.params.filename.toLowerCase().endsWith('.pdf')) {
                                    hasPdf = true;
                                }
                            }
                            // Sometimes inline PDFs exist
                            if (part.type && part.subtype && part.type.toUpperCase() === 'APPLICATION' && part.subtype.toUpperCase() === 'PDF') {
                                hasPdf = true;
                            }
                        }
                    }
                };
                checkStruct(res.attributes.struct);
            }
            if (hasPdf) validEmails.push(res);
        }

        // Get the latest 10
        const top10 = validEmails.slice(-10);
        console.log(`[Test Trigger] 📧 Found ${top10.length} recent emails containing strict PDF attachments.`);

        for (let msg of top10) {
            const uid = msg.attributes.uid;
            console.log(`   -> 🔄 Flagging UID ${uid} as UNSEEN (Unread)`);
            await connection.delFlags(uid, ['\\Seen']);
        }

        console.log(`\n[Test Trigger] ✅ The 10 verifiable PDF emails are now UNSEEN!`);
        console.log(`[Test Trigger] The active backend daemon will ingest them in its next cycle.`);
        
        connection.end();
        process.exit(0);
    } catch(err) {
        console.error("[Test Trigger] 🚨 Error:", err);
        process.exit(1);
    }
}

mark10IdeacomPdfsUnseen();
