const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixHydroscand() {
    console.log('Marking positive Hydroscand invoice as Paid...');
    // The positive invoice ID we found earlier
    await db.collection('invoices').doc('ijx0cBzmocza3zQqRueO').update({ status: 'Paid' });
    console.log('Fixed!');
    process.exit(0);
}

fixHydroscand();
