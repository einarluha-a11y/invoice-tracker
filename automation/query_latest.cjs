const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('invoices').orderBy('createdAt', 'desc').limit(20).get();
    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(doc.id, '=>', data.vendorName, data.amount);

        // Safety check - we know Revolut payments got added as invoices
        // We can delete them if needed, but let's first just list them
    });

    process.exit(0);
}

run();
