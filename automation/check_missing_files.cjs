const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkMissing() {
    const ids = [
        '0evPDLyQZQrPfDG6JrnV', // Re-Est
        'CCV48ePBge2a9B04xNnl', // Tele2
        'LAMohc9pXudqfZMngdWW', // Zone
        'N8LBYglgOIQA13QiMLUa', // Allstore
        'cd3QAILjPP7meyF1uIEf', // Citadele
        'qz9nS7bEXDDYBFrKLyIl'  // IE Technics
    ];
    
    console.log("Checking invoices for missing fileUrl...");
    for (const docId of ids) {
        const doc = await db.collection('invoices').doc(docId).get();
        const data = doc.data();
        if (!data.fileUrl || data.fileUrl === null || data.fileUrl === '') {
            console.log(`MISSING: ${docId} - ${data.vendorName} (${data.invoiceId})`);
        } else {
            console.log(`OK: ${docId} - ${data.vendorName}`);
        }
    }
    process.exit(0);
}
checkMissing();
