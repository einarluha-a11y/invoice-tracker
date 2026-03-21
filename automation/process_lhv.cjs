const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');
const { parseInvoiceDataWithAI, writeToFirestore } = require('./index.js'); // Assuming index.js handles firebase admin init

const IDEACOM_CONFIG = {
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

async function processLHV() {
    console.log("Checking connection to invoices@ideacom.ee...");
    try {
        const connection = await imaps.connect(IDEACOM_CONFIG);
        await connection.openBox('INBOX');

        const today = new Date();
        const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const searchCriteria = [['SINCE', yesterday]];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };
        
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        for (const item of messages) {
            const header = item.parts.find(a => a.which === 'HEADER');
            const subject = header.body.subject[0];
            const from = header.body.from[0];
            
            if (subject.toLowerCase().includes('128446615') || (from.toLowerCase().includes('lhv') && subject.toLowerCase().includes('kindlustus'))) {
                console.log(`\n--- Found matching email! ---`);
                console.log(`Subject: ${subject}`);
                
                const all = item.parts.find(a => a.which === '');
                const parsedEmail = await simpleParser(all.body);

                if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                    for (const attachment of parsedEmail.attachments) {
                        if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                            console.log(`\nExtracting text from PDF: ${attachment.filename}...`);
                            const pdfData = await pdfParse(attachment.content);
                            
                            console.log('--- Sending to AI ---');
                            const parsedData = await parseInvoiceDataWithAI(pdfData.text, "Ideacom OÜ", "");
                            console.log("AI Result:", JSON.stringify(parsedData, null, 2));

                            if (parsedData && parsedData.length > 0) {
                                // IMPORTANT: Use a mocked upload feature or wait for writeToFirestore to do it... 
                                // Actually, index.js writeToFirestore doesn't upload the file, it just trusts the fileUrl it's given!
                                // It expects `invoice.fileUrl`
                                
                                // Let's upload the file ourselves first
                                const admin = require('firebase-admin');
                                const bucket = admin.storage().bucket();
                                const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // IDEACOM
                                
                                const crypto = require('crypto');
                                const cleanFileName = attachment.filename.replace(/[^a-zA-Z0-9.\-_]/g, '');
                                const uniqueName = Date.now() + '_' + cleanFileName;
                                const filePath = `invoices/${companyId}/${uniqueName}`;
                                const file = bucket.file(filePath);
                                const uuid = crypto.randomUUID();

                                await file.save(attachment.content, {
                                    metadata: {
                                        contentType: attachment.contentType,
                                        contentDisposition: 'inline; filename="' + cleanFileName + '"',
                                        metadata: { firebaseStorageDownloadTokens: uuid }
                                    }
                                });

                                const encodedPath = encodeURIComponent(filePath);
                                const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
                                
                                console.log("Uploaded PDF: ", fileUrl);

                                parsedData.forEach(invoice => {
                                    invoice.companyId = companyId;
                                    invoice.fileUrl = fileUrl;
                                });

                                console.log("Writing to Firestore and Zapier...");
                                await writeToFirestore(parsedData);
                                console.log("Done!");
                            } else {
                                console.log("AI returned empty array.");
                            }
                        }
                    }
                }
            }
        }

        connection.end();
        console.log("\nFinished.");
        process.exit(0);
    } catch (e) {
        console.error("Failed:", e);
        process.exit(1);
    }
}

processLHV();
