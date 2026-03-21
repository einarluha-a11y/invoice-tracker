const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app' // ADDED STORAGE BUCKET
    });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const GT_CONFIG = {
    imap: {
        user: 'invoices@gltechnics.com',
        password: '83Gl92tecH42!',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function uploadToStorage(companyId, fileName, contentType, buffer) {
    const crypto = require('crypto');
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

    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${uuid}`;
}

async function fixGTInvoice() {
    const docId = '0evPDLyQZQrPfDG6JrnV';
    const companyId = 'bP6dc0PMdFtnmS5QTX4N';

    try {
        const connection = await imaps.connect(GT_CONFIG);
        await connection.openBox('INBOX');

        const searchCriteria = [['SUBJECT', 'Re-Est invoice']];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };
        const messages = await connection.search(searchCriteria, fetchOptions);

        for (const item of messages) {
            const all = item.parts.find(a => a.which === '');
            const parsedEmail = await simpleParser(all.body);

            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                        console.log(`Found PDF: ${attachment.filename}. Uploading...`);
                        
                        const fileUrl = await uploadToStorage(companyId, attachment.filename, attachment.contentType, attachment.content);
                        console.log(`Uploaded! URL: ${fileUrl}`);

                        console.log('Updating Firestore...');
                        await db.collection('invoices').doc(docId).update({ fileUrl });
                        
                        // Send Zapier webhook - Global Technics doesn't have its own webhook URL, it shares Ideacom's
                        const ideacomId = 'vlhvA6i8d3Hry8rtrA3Z';
                        const compDoc = await db.collection('companies').doc(ideacomId).get();
                        const compData = compDoc.data();
                        const webhookUrl = compData ? compData.zapierWebhookUrl : null;
                        
                        if (!webhookUrl) {
                            console.error('Webhook URL not found for IdeaCom:', ideacomId);
                            process.exit(1);
                        }
                        
                        const payload = {
                            invoiceId: '10032026.01',
                            vendorName: 'Re-Est Czech Group s.r.o.',
                            amount: 8200,
                            currency: 'EUR',
                            dateCreated: '10-03-2026',
                            invoiceYear: '2026',
                            invoiceMonth: '3',
                            dueDate: '25-03-2026',
                            status: 'Unpaid',
                            fileUrl: fileUrl,
                            companyId: companyId,
                            companyName: 'Global Technics OÜ',
                            dropboxFolderPath: '/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_2026/GT_arved_meile_2026_3'
                        };

                        console.log('Sending Webhook to Zapier...');
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        console.log('Webhook delivered!');
                        process.exit(0);
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

fixGTInvoice();
