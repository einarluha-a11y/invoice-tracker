const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkNunnerPaymentAll() {
    console.log('Searching everywhere for NUNNER Logistics UAB payments on Bank Statements...');

    const companiesSnapshot = await db.collection('companies').get();
    let imapUser, imapPassword, imapHost, imapPort;
    companiesSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.name.toUpperCase().includes('IDEACOM')) {
            imapUser = data.imapUser;
            imapPassword = data.imapPassword;
            imapHost = data.imapHost;
            imapPort = data.imapPort;
        }
    });

    const config = {
        imap: {
            user: imapUser, password: imapPassword, host: imapHost.trim(), port: imapPort || 993,
            tls: true, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        const messages = await connection.search(['ALL'], { bodies: [''] });

        let found = false;
        console.log(`Scanning through ${messages.length} total emails...`);

        for (const msg of messages) {
            const all = msg.parts.find(p => p.which === '');
            const parsedEmail = await simpleParser(all.body);

            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const att of parsedEmail.attachments) {
                    if (att.filename && (att.filename.toLowerCase().includes('revolut') || att.filename.toLowerCase().includes('statement'))) {
                        if (att.filename.toLowerCase().includes('.pdf')) {
                            const pdfText = await pdfParse(att.content);
                            if (pdfText.text.toLowerCase().includes('nunner') || pdfText.text.includes('4500')) {
                                console.log(`\n--- FOUND POTENTIAL PAYMENT IN PDF: ${att.filename} ---`);
                                found = true;
                            }
                        } else if (att.filename.toLowerCase().includes('.csv')) {
                            const csvText = att.content.toString('utf-8');
                            if (csvText.toLowerCase().includes('nunner') || csvText.includes('4500')) {
                                console.log(`\n--- FOUND POTENTIAL PAYMENT IN CSV: ${att.filename} ---`);
                                found = true;
                            }
                        }
                    }
                }
            }
        }
        if (!found) console.log("No statements contained NUNNER or 4500.");
        connection.end();
    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

checkNunnerPaymentAll();
