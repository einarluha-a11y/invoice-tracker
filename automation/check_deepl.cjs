const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkDeepL() {
    console.log('Querying for DeepL invoices...');
    const snapshot = await db.collection('invoices').get();

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('deepl')) {
            console.log(`Found: ID: ${doc.id}, Vendor: ${data.vendorName}, Amount: ${data.amount}, Status: ${data.status}, InvoiceID: ${data.invoiceId}`);
            console.log(`Full data:`, JSON.stringify(data, null, 2));
        }
    });

    process.exit(0);
}

checkDeepL();
