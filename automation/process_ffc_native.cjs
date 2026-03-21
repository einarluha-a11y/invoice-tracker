require('dotenv').config();
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');

// Our new native intelligent extraction service
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
   admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
   });
}
const db = admin.firestore();

async function uploadToStorage(companyId, fileName, contentType, buffer) {
    try {
        const bucket = admin.storage().bucket();
        const secureFileName = `${companyId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const file = bucket.file(secureFileName);
        
        await file.save(buffer, {
            metadata: { contentType: contentType }
        });

        const expires = new Date();
        expires.setFullYear(expires.getFullYear() + 10);
        const [url] = await file.getSignedUrl({ action: 'read', expires: expires });
        return url;
    } catch (e) {
        console.error("Upload Error:", e);
        return null;
    }
}

async function fixFFC() {
    console.log("[DB] Deleting the bad FFC Logistika record...");
    const badDocs = await db.collection('invoices')
        .where('invoiceId', '==', 'DOC-20260318-WA0034')
        .get();
        
    for (const doc of badDocs.docs) {
        console.log(`[DB] Trashing corrupt record: ${doc.id}`);
        await doc.ref.delete();
    }
    
    console.log("\n[IMAP] Connecting to Ideacom INBOX to retrieve the original PDF...");
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

        // We search the entire inbox to strictly pinpoint the exact email the user meant
        const searchCriteria = ['ALL'];
        const fetchOptions = { bodies: [''], struct: true, markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        let found = false;
        
        // Loop backwards to find the most recent matching subject
        for (let i = messages.length - 1; i >= 0; i--) {
            const item = messages[i];
            const all = item.parts.filter(part => part.which === '')[0];
            const parsed = await simpleParser(all.body);
            const subject = parsed.subject ? parsed.subject.toLowerCase() : '';

            if (subject.includes('урал')) {
                console.log(`\n[IMAP] FOUND EXACT EMAIL: ${parsed.subject}`);

                for (const att of parsed.attachments) {
                    if (att.contentType === 'application/pdf') {
                         console.log(`[IMAP] Extracted pristine PDF: ${att.filename} (${att.content.length} bytes)`);
                         const fileBuffer = att.content;
                         
                         console.log(`[Storage] Uploading PDF to Firebase Storage...`);
                         const fileUrl = await uploadToStorage(companyId, att.filename, att.contentType, fileBuffer);
                         console.log(`[Storage] Secured URL: ${fileUrl}`);

                         console.log(`[Document AI] Streaming PDF to Google Cloud Intelligent Parser...`);
                         const parsedDataArray = await processInvoiceWithDocAI(fileBuffer, att.contentType);
                         
                         console.log("\n====================================");
                         console.log("🤖 Document AI Payload:");
                         console.log("====================================\n");
                         console.log(JSON.stringify(parsedDataArray, null, 2));

                         if (parsedDataArray && parsedDataArray.length > 0) {
                             const perfectData = parsedDataArray[0];
                             // Inject the URL so it renders in the UI
                             perfectData.fileUrl = fileUrl;
                             perfectData.companyId = companyId;
                             perfectData.createdAt = admin.firestore.FieldValue.serverTimestamp();
                             
                             console.log(`\n[DB] Committing perfect record to Firestore...`);
                             await db.collection('invoices').add(perfectData);
                             console.log(`[DB] Commit successful! Desktop App will auto-update.`);
                         }
                         found = true;
                         break;
                    }
                }
            }
            if (found) break; // Finished parsing the target email
        }
        
    } catch (err) {
        console.error("Error:", err);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}

fixFFC();
