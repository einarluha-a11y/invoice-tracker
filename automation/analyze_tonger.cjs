require('dotenv').config();
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
const { classifyDocumentWithVision } = require('./vision_auditor.cjs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    console.log('[Dev] 🔍 Booting Sandbox for Tonger Recovery...');
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

        const searchCriteria = [['FROM', 'tonger.by']];
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], struct: true, markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        if (messages.length === 0) {
            console.log('No Tonger emails found.');
            return;
        }

        const msg = messages[messages.length - 1]; // Latest tonger email
        console.log(`[Dev] Found Email UID: ${msg.attributes.uid}`);
        
        const allPart = msg.parts.find(p => p.which === '');
        const parsedEmail = await simpleParser(allPart.body);
        
        console.log(`[Dev] Attachments count: ${parsedEmail.attachments.length}`);
        
        for (const attachment of parsedEmail.attachments) {
            console.log(`\n📄 Attachment: ${attachment.filename} (${attachment.contentType})`);
            
            console.log(`[Vision] Checking for CMR...`);
            const visionClass = await classifyDocumentWithVision(attachment.content);
            console.log(`[Vision] Verdict: ${visionClass}`);
            
            if (visionClass === 'INVOICE') {
                console.log(`[DocAI] Pushing to Document AI...`);
                const parsedData = await processInvoiceWithDocAI(attachment.content, attachment.contentType || 'application/pdf');
                console.log(`[DocAI] Raw Output:`, JSON.stringify(parsedData, null, 2));
            }
        }

    } catch(e) {
        console.error('[Dev] Error:', e);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}
run();
