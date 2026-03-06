const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('invoices').where('invoiceId', '==', '4-2026').get();
    if (snapshot.empty) {
        console.log('No matching documents found for 4-2026.');
    }
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(doc.id, '=>', data);
    });

    // also try partial match just in case
    const snapshot2 = await db.collection('invoices').get();
    console.log('--- Partial matches for GEORGIA ---');
    snapshot2.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('georgia')) {
            console.log(doc.id, '=>', data);
        }
    });

    process.exit(0);
}

run();
