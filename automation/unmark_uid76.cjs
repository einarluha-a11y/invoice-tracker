const imaps = require('imap-simple');
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function unmarkUID76() {
    console.log("Fetching companies from Firestore to get Ideacom credentials...");
    const snapshot = await db.collection('companies').get();

    let targetCompany = null;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.name && data.name.includes('Ideacom')) {
            targetCompany = data;
        }
    });

    if (!targetCompany || !targetCompany.imapUser || !targetCompany.imapPassword) {
        console.log("No IMAP config found.");
        process.exit(1);
    }

    const company = targetCompany;

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
        console.log("INBOX opened. Removing SEEN flag from UID 76...");

        await connection.delFlags(76, ['\\Seen']);
        console.log("UID 76 successfully marked as UNREAD. The Railway bot will process it shortly.");

        connection.end();
        process.exit(0);

    } catch (err) {
        console.error("IMAP Error:", err);
        process.exit(1);
    }
}

unmarkUID76();
