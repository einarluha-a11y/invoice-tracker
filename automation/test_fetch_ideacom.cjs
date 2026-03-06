const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin (from local credentials)
const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkLatestIdeacomEmails() {
    console.log("Fetching companies from Firestore to get Ideacom credentials...");
    const snapshot = await db.collection('companies').get();

    let targetCompany = null;
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Company: '${data.name}' has IMAP: ${!!data.imapConfig}`);
        if (data.name && data.name.includes('Ideacom')) {
            targetCompany = data;
        }
    });

    if (!targetCompany) {
        console.log("Ideacom not found.");
        process.exit(1);
    }

    const company = targetCompany;
    if (!company.imapUser || !company.imapPassword) {
        console.log("No IMAP config found for target company.");
        process.exit(1);
    }

    const config = {
        imap: {
            user: company.imapUser,
            password: company.imapPassword,
            host: company.imapHost.trim(),
            port: company.imapPort || 993,
            tls: true,
            authTimeout: 15000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    try {
        console.log(`[Email] Connecting to IMAP server for ${company.name}...`);
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        console.log("INBOX opened. Fetching latest 5 emails (seen or unseen)...");

        // Fetch latest 5 emails by UID
        const searchCriteria = ['ALL'];
        const fetchOptions = {
            bodies: [''],
            markSeen: false,
            struct: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found total ${messages.length} messages in INBOX.`);

        const latestMessages = messages.slice(-5);
        for (const item of latestMessages) {
            const all = item.parts.find(part => part.which === '');
            const id = item.attributes.uid;

            if (all && all.body) {
                const parsed = await simpleParser(all.body);
                console.log(`-- Email UID: ${id} --`);
                console.log(`Date: ${parsed.date}`);
                console.log(`Subject: ${parsed.subject}`);
                console.log(`From: ${parsed.from.text}`);
                console.log(`Flags: ${item.attributes.flags}`);
                console.log(`Attachments: ${parsed.attachments ? parsed.attachments.length : 0}`);
                console.log("----------------------");
            }
        }

        connection.end();
        process.exit(0);

    } catch (err) {
        console.error("IMAP Error:", err);
        process.exit(1);
    }
}

checkLatestIdeacomEmails();
