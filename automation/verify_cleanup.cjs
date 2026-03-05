const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function verify() {
    const snapshot = await db.collection('invoices').limit(5).get();
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`${doc.id} -> vendor: ${data.vendorName}, desc: ${data.description}, invoiceId: ${data.invoiceId}`);
    });
    process.exit(0);
}

verify();
