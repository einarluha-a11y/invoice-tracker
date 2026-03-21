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

const missingIdeacom = [
    { id: 'BTDcSiRsY3qnDRA0KGiT', keyword: 'ФФК', companyId: 'vlhvA6i8d3Hry8rtrA3Z' },
    { id: 'aWoQpM0aZg66AbNjlyGA', keyword: 'ФФК', companyId: 'vlhvA6i8d3Hry8rtrA3Z' },
    { id: 'G7BzUbejbJHAXneX68y1', keyword: 'PRONTO', companyId: 'vlhvA6i8d3Hry8rtrA3Z' },
    { id: 'k07jTQTB6Q0ZqiqQDJeu', keyword: 'PRONTO', companyId: 'vlhvA6i8d3Hry8rtrA3Z' },
    { id: 'slys54mmO3gi6oSCexhs', keyword: 'Ursus', companyId: 'vlhvA6i8d3Hry8rtrA3Z' },
    { id: 'xVjKlP5wtWQrN3aFe10X', keyword: 'DMG', companyId: 'vlhvA6i8d3Hry8rtrA3Z' }
];

const missingGT = [
    { id: 'CvH47yk69vjpPKm8y6BM', keyword: 'Täisteenusliisingu', companyId: 'bP6dc0PMdFtnmS5QTX4N' },
    { id: 'X3Z74WxnW1J8UobeKgoZ', keyword: 'Täisteenusliisingu', companyId: 'bP6dc0PMdFtnmS5QTX4N' },
    { id: 'P6Wpmy1bEcaiyJI0nr8w', keyword: 'Tööriistalaenutus', companyId: 'bP6dc0PMdFtnmS5QTX4N' },
    { id: 'vu9RtCHlk4nRn8y0D1z0', keyword: 'Allstore', companyId: 'bP6dc0PMdFtnmS5QTX4N' }
];

async function recoverMailbox(config, missingDocs, label) {
    if (missingDocs.length === 0) return;
    
    console.log(`\nConnecting to ${label} inbox...`);
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Note: IMAP uses Date object for SINCE formatting
        const sinceDate = new Date('2026-03-01T00:00:00Z');
        const searchCriteria = [['SINCE', sinceDate]];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };

        console.log(`Fetching emails since March 1, 2026 for ${label}...`);
        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} recent emails.`);

        // Sort missing by keyword to avoid checking everything multiple times, 
        // but just nested loop since count is small
        for (const target of missingDocs) {
            console.log(`\nLooking for PDF for keyword: "${target.keyword}" (DocID: ${target.id})...`);
            let foundPdf = false;
            let fileUrl = null;

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
                            if (attachment.contentType.includes('pdf') || attachment.filename.toLowerCase().endsWith('.pdf')) {
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
                console.log(`  -> Could not find a PDF attachment for ${target.keyword} in the inbox.`);
            }
        }
        connection.end();
    } catch (e) {
        console.error(`Error processing ${label}:`, e);
    }
}

async function run() {
    await recoverMailbox(IC_CONFIG, missingIdeacom, 'Ideacom');
    await recoverMailbox(GT_CONFIG, missingGT, 'Global Technics');
    console.log("\nRecovery script finished.");
    process.exit(0);
}

run();
