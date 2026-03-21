require('dotenv').config();
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');

const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');

const serviceAccount = require('./google-credentials.json');
let firestoreDb;
if (!admin.apps.length) {
   admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
   });
}
firestoreDb = admin.firestore();

async function check() {
    console.log("Starting IMAP connection for Agent Simulation...");
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
    const companyDoc = await firestoreDb.collection('companies').doc(companyId).get();
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
        const fetchOptions = { bodies: [''], struct: true, markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        // Loop backwards
        for (let i = messages.length - 1; i >= 0; i--) {
            const item = messages[i];
            const all = item.parts.filter(part => part.which === '')[0];
            const parsed = await simpleParser(all.body);
            const subject = parsed.subject ? parsed.subject.toLowerCase() : '';

            if (subject.includes('урал')) {
                console.log(`\n--- FOUND EXACT EMAIL ---`);
                console.log(`Subject: ${parsed.subject}`);

                for (const att of parsed.attachments) {
                    if (att.contentType === 'application/pdf') {
                        console.log(`\nProcessing PDF: ${att.filename}`);
                        const pdfBytes = att.content;
                        
                        console.log(`\n[1] Pushing to Document AI (The Eyes)...`);
                        const parsedDataArray = await processInvoiceWithDocAI(pdfBytes, 'application/pdf');
                        let docAiData = parsedDataArray[0];
                        docAiData.amount = 9999.99; // Bypasses the deduplication check
                        
                        console.log(`\n[2] Pushing to Accountant Agent (The Brain)...`);
                        // Use a dummy file URL for the test so we don't re-upload
                        const dummyUrl = 'https://firebasestorage.googleapis.com/v0/b/test/dummy.pdf';
                        const finalPayload = await auditAndProcessInvoice(docAiData, dummyUrl, companyId);
                        
                        console.log("\n====================================");
                        console.log("🤖 FINAL AGENT JSON PAYLOAD:");
                        console.log("====================================\n");
                        console.log(JSON.stringify(finalPayload, null, 2));

                        break;
                    }
                }
                break;
            }
        }
    } catch (err) {
        console.error("Error:", err);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}
check();

