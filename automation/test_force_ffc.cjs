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
const { processAttachment } = require('./index.js'); // Wait, earlier this failed. 
// I need to use the checkEmailForInvoices logic manually or re-export processAttachment.

async function manualForceExtract() {
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
        console.log("Connecting to Ideacom IMAP directly...");
        connection = await Imap.connect(config);
        await connection.openBox('INBOX');

        // Search ALL emails to bypass UNSEEN flag
        const messages = await connection.search(['ALL'], { bodies: [''], struct: true, markSeen: false });
        const recentMessages = messages.slice(-50); // Get last 50 emails

        let found = false;
        for (const item of recentMessages) {
            const all = item.parts.filter(part => part.which === '')[0];
            const parsed = await simpleParser(all.body);
            const subject = parsed.subject ? parsed.subject.toLowerCase() : '';

            if (subject.includes('урал')) {
                found = true;
                console.log(`\n--- FOUND EXACT EMAIL: ${parsed.subject} ---`);
                
                // We must use parseInvoiceDataWithAI and writeToFirestore from index.js directly,
                // instead of checkEmailForInvoices which only looks at UNSEEN
                
                const indexJs = require('./index.js');
                
                for (const attachment of parsed.attachments) {
                    if (attachment.contentType === 'application/pdf') {
                        console.log(`Extracting: ${attachment.filename}`);
                        
                        // Let's use the exported indexJs.parseInvoiceDataWithAI if possible
                        // Or we can just use Claude directly here since it's a script
                        
                        // The easiest way is to temporarily patch checkEmailForInvoices to look at ALL instead of UNSEEN.
                        // I will do that instead of rewriting the 200 line extraction pipeline.
                    }
                }
            }
        }
        if (!found) console.log("Email with text 'урал' not found in last 50 emails.");
    } catch(err) {
        console.error("Error:", err);
    } finally {
        if(connection) connection.end();
        process.exit(0);
    }
}
manualForceExtract();
