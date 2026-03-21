require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: "invoice-tracker-xyz.firebasestorage.app"
    });
}
const db = admin.firestore();
const { checkEmailForInvoices } = require('./index.js'); 

async function manualFixDella() {
    console.log("Deleting corrupted Della entry SXViFHJhu7x810WtRfXv...");
    try {
        await db.collection('invoices').doc('SXViFHJhu7x810WtRfXv').delete();
        console.log("Deleted successfully.");
    } catch(e) { }
    
    // Now trigger the actual index.js engine to do a full run on Ideacom
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const cData = companyDoc.data();
    
    const config = {
        user: cData.imapUser,
        password: cData.imapPassword,
        host: cData.imapHost.trim(),
        port: cData.imapPort
    };

    console.log(`\nForcing full checkEmailForInvoices for ${cData.name}...`);
    // NOTE: This relies on indexJs.js having ['ALL'] set for Ideacom, or we can just patch index.js temporarily again
    
    // We patched checkEmailForInvoices to accept the config object
    await checkEmailForInvoices(config, cData.name, companyId, cData.customRules || "");
    console.log("Done checking Ideacom.");
    process.exit(0);
}
manualFixDella();
