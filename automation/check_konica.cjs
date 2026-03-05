const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkKonica() {
    console.log('Querying for Konica Minolta invoice...');

    const snapshot = await db.collection('invoices').get();

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('konica')) {
            console.log(`Found: ID: ${doc.id}, Vendor: ${data.vendorName}, Amount: ${data.amount}, Currency: ${data.currency}, Status: ${data.status}, InvoiceID: ${data.invoiceId}`);
        }
    });

    process.exit(0);
}

checkKonica();
