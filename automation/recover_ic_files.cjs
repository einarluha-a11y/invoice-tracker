const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
const crypto = require('crypto');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const IC_CONFIG = {
    imap: {
        user: 'invoices@ideacom.ee',
        password: '9d2EB2!cZ79Z9jp',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function uploadToStorage(companyId, fileName, contentType, buffer) {
    const cleanFileName = fileName ? fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'document.pdf';
    const uniqueName = Date.now() + '_' + cleanFileName;
    const filePath = `invoices/${companyId}/${uniqueName}`;
    const file = bucket.file(filePath);
    const uuid = crypto.randomUUID();

    await file.save(buffer, {
        metadata: {
            contentType: contentType,
            contentDisposition: 'inline; filename="' + cleanFileName + '"',
            metadata: { firebaseStorageDownloadTokens: uuid }
        }
    });

    const encodedPath = encodeURIComponent(filePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
}

async function recoverMissingFiles() {
    const missingDocs = [
        { id: 'tGabWY18qXmn7PBXkMKi', vendor: 'PRONTO', keyword: 'PRONTO' }
    ];
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z';

    console.log("Connecting to Ideacom inbox...");
    try {
        const connection = await imaps.connect(IC_CONFIG);
        await connection.openBox('INBOX');

        const searchCriteria = [['ALL']];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };
        
        console.log("Fetching emails...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} emails to check.`);

        for (const target of missingDocs) {
            console.log(`\nLooking for PDF for: ${target.vendor}...`);
            let foundPdf = false;

            for (const item of messages) {
                const header = item.parts.find(a => a.which === 'HEADER');
                const subject = header.body.subject[0] || '';
                const from = header.body.from[0] || '';

                if (subject.toLowerCase().includes(target.keyword.toLowerCase()) || from.toLowerCase().includes(target.keyword.toLowerCase())) {
                    console.log(`  -> Match found in email: "${subject}" from ${from}`);
                    
                    const all = item.parts.find(a => a.which === '');
                    const parsedEmail = await simpleParser(all.body);

                    if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                        for (const attachment of parsedEmail.attachments) {
                            if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                                console.log(`  -> Found PDF: ${attachment.filename}. Uploading...`);
                                
                                const fileUrl = await uploadToStorage(companyId, attachment.filename, attachment.contentType, attachment.content);
                                console.log(`  -> Uploaded successfully.`);

                                await db.collection('invoices').doc(target.id).update({ fileUrl });
                                foundPdf = true;
                                break; 
                            }
                        }
                    }
                    if (foundPdf) break; 
                }
            }
            if (!foundPdf) {
                console.log(`  -> Could not find a PDF attachment for ${target.vendor} in the inbox.`);
            }
        }

        connection.end();
        console.log("\nRecovery script finished.");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

recoverMissingFiles();
