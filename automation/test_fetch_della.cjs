require('dotenv').config();
const admin = require('firebase-admin');
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "invoice-tracker-xyz.firebasestorage.app"
    });
}
const db = admin.firestore();

// Patch index.js locally to use ALL instead of UNSEEN, or just do manual extraction here to see raw Claude result
const { processAttachment } = require('./index.js'); // Wait, we removed this earlier.
// Actually I don't need processAttachment right now. I just need to retrieve the Della email and see what it contains to feed to Claude directly.

async function fetchDellaEmail() {
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
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

    let connection;
    try {
        console.log("Connecting to Ideacom...");
        connection = await Imap.connect(config);
        await connection.openBox('INBOX');

        const messages = await connection.search(['ALL'], { bodies: [''], struct: true, markSeen: false });
        for (const item of messages.slice(-50)) {
            const all = item.parts.filter(part => part.which === '')[0];
            const parsed = await simpleParser(all.body);
            const subject = parsed.subject ? parsed.subject.toLowerCase() : '';

            // Searching for Della
            if (subject.includes('della') || (parsed.text && parsed.text.toLowerCase().includes('della'))) {
                console.log(`\n--- FOUND DELLA EMAIL: ${parsed.subject} ---`);
                
                for (const att of parsed.attachments) {
                    console.log(`Attachment: ${att.filename} (${att.contentType})`);
                    if (att.contentType === 'application/pdf') {
                        const fs = require('fs');
                        fs.writeFileSync(`test_${att.filename}`, att.content);
                        console.log(`Saved ${att.filename} locally for text extraction tests.`);
                    }
                }
            }
        }
    } catch(err) {
        console.error("Error:", err);
    } finally {
        if(connection) connection.end();
        process.exit(0);
    }
}
fetchDellaEmail();
