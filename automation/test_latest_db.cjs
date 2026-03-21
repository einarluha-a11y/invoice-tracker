const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
    try {
        const snapshot = await db.collection('invoices').orderBy('createdAt', 'desc').limit(5).get();
        console.log('--- RECENT INVOICES ---');
        snapshot.forEach(doc => {
            const d = doc.data();
            console.log(`${d.vendorName} | ${d.amount} | ID: ${d.invoiceId} | Created: ${d.createdAt?.toDate().toISOString()}`);
        });
    } catch (e) {
        console.error(e);
    }
}
run();
