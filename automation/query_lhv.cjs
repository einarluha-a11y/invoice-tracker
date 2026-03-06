const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('invoices').get();
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName.toLowerCase().includes('lhv') || String(data.invoiceId).includes('112443348')) {
            console.log(doc.id, '=>', data);
        }
    });
    process.exit(0);
}

run();
