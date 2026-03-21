require('dotenv').config();
const admin = require('firebase-admin');
const Imap = require('imap-simple');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "invoice-tracker-xyz.firebasestorage.app"
    });
}
const db = admin.firestore();
const { checkEmailForInvoices } = require('./index.js');

async function testConnection() {
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const cData = companyDoc.data();
    
    console.log(`Company: ${cData.name}`);
    console.log(`User: ${cData.imapUser}`);
    console.log(`Host: ${cData.imapHost}`);
    console.log(`Port: ${cData.imapPort}`);

    const config = {
        imap: {
            user: cData.imapUser,
            password: cData.imapPassword,
            host: cData.imapHost.trim(),
            port: cData.imapPort,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000
        }
    };

    try {
        console.log("Connecting...");
        const connection = await Imap.connect(config);
        console.log("Connected.");
        await connection.openBox('INBOX');
        console.log("Opened INBOX.");

        // Now run the actual function that index.js uses that was failing 
        console.log("Running checkEmailForInvoices on Ideacom...");
        await checkEmailForInvoices(cData, companyId);
        console.log("Done.");

        connection.end();
    } catch(err) {
        console.error("Error:", err);
    }
    process.exit(0);
}
testConnection();
