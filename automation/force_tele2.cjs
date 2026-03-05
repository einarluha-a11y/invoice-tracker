const ImapClient = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { parseInvoiceDataWithAI, writeToFirestore, reconcilePayment } = require('./index.js');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const config = {
    imap: { user: 'invoices@gltechnics.com', password: process.env.IMAP_PASSWORD || 'Oleg2003$', host: 'imap.zone.eu', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 }
};

async function force() {
    try {
        const connection = await ImapClient.connect(config);
        await connection.openBox('INBOX');
        const results = await connection.search([['UID', '187']], { bodies: [''], struct: true });
        
        const all = results[0].parts.find(a => a.which === '');
        const parsedEmail = await simpleParser(all.body);
        
        for (const attachment of parsedEmail.attachments) {
            const filename = (attachment.filename || '').toLowerCase();
            const mime = (attachment.contentType || '').toLowerCase();
            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                const pdfData = await pdfParse(attachment.content);
                const rawContent = pdfData.text;
                
                // Emulate the live AI pipeline
                console.log("Parsing TELE2 PDF with AI...");
                const parsedData = await parseInvoiceDataWithAI(rawContent, "Global Backend Default", "");
                if (parsedData) {
                    parsedData.forEach(inv => inv.companyId = "bP6dc0PMdFtnmS5QTX4N");
                    
                    // Monkeypatch the server port conflict by redefining writeToFirestore logic directly
                    const admin = require('firebase-admin');
                    const db = admin.firestore();
                    const batch = db.batch();
                    const invoicesRef = db.collection('invoices');
                    for (const data of parsedData) {
                        const newRef = invoicesRef.doc();
                        batch.set(newRef, {
                            invoiceId: data.invoiceId, vendorName: data.vendorName,
                            amount: data.amount, currency: 'EUR',
                            dateCreated: data.dateCreated, dueDate: data.dueDate,
                            status: 'Unpaid', createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            companyId: data.companyId, description: data.description || ''
                        });
                        console.log(`Writing to DB: ${data.vendorName} - ${data.amount}`);
                    }
                    await batch.commit();
                    console.log("Successfully force-injected TELE2 invoice into Firestore.");
                }
            }
        }
        connection.end();
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
force();
