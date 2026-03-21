const admin = require("firebase-admin");
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const serviceAccount = require("./google-credentials.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

const imapConfig = {
    imap: {
        user: "invoices@gltechnics.com",
        password: "83Gl92tecH42!", 
        host: "imap.zone.eu",
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function fixDeepl() {
    const invoiceDocId = 'Eb9pboDR7zcd4VNKLwP0'; // The DeepL invoice missing the PDF
    const companyId = 'bP6dc0PMdFtnmS5QTX4N';

    console.log(`Connecting to IMAP...`);
    const connection = await imaps.connect(imapConfig);
    console.log('Connected! Opening INBOX.');
    await connection.openBox('INBOX');

    const searchCriteria = [['UID', 197]];
    const fetchOptions = { bodies: [''], struct: true };

    const messages = await connection.search(searchCriteria, fetchOptions);
    
    if (messages.length > 0) {
        const item = messages[0];
        const all = item.parts.find(a => a.which === '');
        const parsedEmail = await simpleParser(all.body);
        
        for (const attachment of parsedEmail.attachments) {
            const filename = (attachment.filename || '').toLowerCase();
            const mime = (attachment.contentType || '').toLowerCase();
            
            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                console.log(`Uploading ${filename} to Storage...`);
                let fileUrl = null;
                try {
                    // Requires exposing uploadToStorage in index.js or duplicating it here.
                    // Given we can't easily require it without executing pollAllCompanyInboxes, 
                    // Let's duplicate the basic Firebase Storage upload logic.
                    
                    const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');
                    const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const destination = `invoices/${companyId}/${Date.now()}_${safeFilename}`;
                    const file = bucket.file(destination);

                    await file.save(attachment.content, {
                        metadata: { contentType: mime || 'application/pdf' },
                        resumable: false
                    });
                    
                    await file.makePublic();
                    fileUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;
                    console.log(`Successfully uploaded! URL: ${fileUrl}`);

                } catch (err) {
                    console.error("Storage upload failed:", err);
                }

                if (fileUrl) {
                    console.log(`Updating Firestore document ${invoiceDocId}...`);
                    await db.collection('invoices').doc(invoiceDocId).update({
                        fileUrl: fileUrl
                    });
                    console.log("Firestore updated successfully.");
                }
            }
        }
    } else {
        console.log("Could not find UID 197.");
    }
    
    connection.end();
}

fixDeepl().catch(console.error).finally(() => process.exit(0));
