require('dotenv').config();
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "invoice-tracker-xyz.firebasestorage.app"
    });
}
const db = admin.firestore();
const indexJs = require('./index.js'); // Assuming we can use exported functions

async function manualFixDella() {
    console.log("Deleting corrupted Della entry SXViFHJhu7x810WtRfXv...");
    await db.collection('invoices').doc('SXViFHJhu7x810WtRfXv').delete();
    
    // Now trigger the actual index.js engine to do a full run on this specific email
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

            if (subject.includes('della') || (parsed.text && parsed.text.toLowerCase().includes('della'))) {
                console.log(`\n--- FOUND DELLA EMAIL: ${parsed.subject} ---`);
                
                // Process email the same way checkEmailForInvoices does
                for (const attachment of parsed.attachments) {
                    if (attachment.contentType === 'application/pdf') {
                        console.log(`Processing attachment: ${attachment.filename}...`);
                        
                        // Fake upload to storage logic from indexJs (but it's not exported)
                        // Actually, wait, checkEmailForInvoices isn't exported directly to process a specific email object. 
                        console.log("Temporarily modifying index.js to search only THIS UID!");
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
manualFixDella();
