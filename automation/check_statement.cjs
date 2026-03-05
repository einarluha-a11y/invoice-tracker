const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const pdfParse = require('pdf-parse');
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkBankStatementDeep() {
    console.log('Searching for the Revolut Bank Statement covering December 2025...');

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
        const messages = await connection.search(['ALL', ['BODY', 'Revolut']], { bodies: [''] });

        for (const msg of messages) {
            const all = msg.parts.find(p => p.which === '');
            const parsedEmail = await simpleParser(all.body);

            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const att of parsedEmail.attachments) {
                    if (att.filename && att.filename.toLowerCase().includes('revolut') && att.filename.toLowerCase().includes('.pdf')) {
                        console.log(`\nFound Bank Statement PDF: ${att.filename}`);
                        const pdfText = await pdfParse(att.content);

                        // We are looking for an amount of 282.10
                        const lines = pdfText.text.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].includes('282.10') || lines[i].toLowerCase().includes('accounting')) {
                                console.log("\n--- Potential Match Found ---");
                                console.log(lines.slice(Math.max(0, i - 10), i + 10).join('\n'));
                            }
                        }
                    }
                }
            }
        }
        connection.end();
    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

checkBankStatementDeep();
