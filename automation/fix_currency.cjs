const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixCurrency() {
    console.log('[DB] Searching for bad € currencies...');
    const snapshot = await db.collection('invoices')
        .where('currency', '==', '€')
        .get();

    for (const doc of snapshot.docs) {
        console.log(`[DB] Fixing bad currency in document ID: ${doc.id}`);
        await doc.ref.update({ currency: 'EUR' });
    }
    console.log('[DB] EUR Currency fix complete.');
}

fixCurrency().then(() => process.exit(0)).catch(console.error);
