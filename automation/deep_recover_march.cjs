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
    imap: { user: 'invoices@ideacom.ee', password: '9d2EB2!cZ79Z9jp', host: 'imap.zone.eu', port: 993, tls: true, authTimeout: 30000, connTimeout: 30000, tlsOptions: { rejectUnauthorized: false } }
};

const GT_CONFIG = {
    imap: { user: 'invoices@gltechnics.com', password: '83Gl92tecH42!', host: 'imap.zone.eu', port: 993, tls: true, authTimeout: 30000, connTimeout: 30000, tlsOptions: { rejectUnauthorized: false } }
};

async function uploadToStorage(companyId, fileName, contentType, buffer) {
    const cleanFileName = fileName ? fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'document.pdf';
    const filePath = `invoices/${companyId}/${Date.now()}_${cleanFileName}`;
    const file = bucket.file(filePath);
    const uuid = crypto.randomUUID();
    await file.save(buffer, { metadata: { contentType, contentDisposition: `inline; filename="${cleanFileName}"`, metadata: { firebaseStorageDownloadTokens: uuid } } });
    const encodedPath = encodeURIComponent(filePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
}

const missingIdeacom = [
    { id: 'BTDcSiRsY3qnDRA0KGiT', vendor: 'ФФК', companyId: 'vlhvA6i8d3Hry8rtrA3Z', date: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-04T00:00:00Z') },
    { id: 'aWoQpM0aZg66AbNjlyGA', vendor: 'ФФК', companyId: 'vlhvA6i8d3Hry8rtrA3Z', date: new Date('2026-03-17T00:00:00Z'), end: new Date('2026-03-20T00:00:00Z') }
];

const missingGT = [
    { id: 'vu9RtCHlk4nRn8y0D1z0', vendor: 'Allstore', companyId: 'bP6dc0PMdFtnmS5QTX4N', date: new Date('2026-03-17T00:00:00Z'), end: new Date('2026-03-20T00:00:00Z') }
];

async function recoverByDate(config, targets, label) {
    if (targets.length === 0) return;
    
    console.log(`\nConnecting to ${label} inbox...`);
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        for (const target of targets) {
            console.log(`\nDeep Scan for: "${target.vendor}" (DocID: ${target.id}) between ${target.date.toISOString()} and ${target.end.toISOString()}...`);
            let foundPdf = false;
            let fileUrl = null;

            const searchCriteria = [['SINCE', target.date], ['BEFORE', target.end]];
            const fetchOptions = { bodies: ['HEADER', ''], struct: true };

            const messages = await connection.search(searchCriteria, fetchOptions);
            console.log(`Found ${messages.length} emails in date range. Scanning ALL PDFs...`);

            for (const item of messages) {
                const header = item.parts.find(a => a.which === 'HEADER');
                const subject = (header.body.subject && header.body.subject[0]) || '';
                const from = (header.body.from && header.body.from[0]) || '';
                
                const all = item.parts.find(a => a.which === '');
                const parsedEmail = await simpleParser(all.body);

                if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                    for (const attachment of parsedEmail.attachments) {
                        if (attachment.contentType.includes('pdf') || attachment.filename.toLowerCase().endsWith('.pdf')) {
                            // Only match if the PDF name itself has a clue, or from address has a clue
                            // If it's a generic name like "invoice.pdf", it's risky. But let's check for any hint in the text
                            if (parsedEmail.text && parsedEmail.text.toLowerCase().includes(target.vendor.toLowerCase().slice(0, 3))) {
                                console.log(`  -> Match found in email BODY: "${subject}" from ${from}`);
                                console.log(`  -> Found PDF: ${attachment.filename}. Uploading...`);
                                fileUrl = await uploadToStorage(target.companyId, attachment.filename, attachment.contentType, attachment.content);
                                console.log(`  -> Uploaded successfully.`);
                                foundPdf = true;
                                break;
                            }
                        }
                    }
                }
                if (foundPdf) break; 
            }
            if (foundPdf && fileUrl) {
                console.log(`  -> Updating Firestore doc ${target.id}...`);
                await db.collection('invoices').doc(target.id).update({ fileUrl });
            } else {
                console.log(`  -> Could not find a PDF attachment for ${target.vendor} in the date range.`);
            }
        }
        connection.end();
    } catch (e) {
        console.error(`Error processing ${label}:`, e);
    }
}

async function run() {
    await recoverByDate(IC_CONFIG, missingIdeacom, 'Ideacom');
    await recoverByDate(GT_CONFIG, missingGT, 'Global Technics');
    console.log("\nDeep Recovery script finished.");
    process.exit(0);
}

run();
