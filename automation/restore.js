const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function restoreSuprun() {
    console.log("Restoring Suprun to Unpaid/3600...");
    const snapshot = await db.collection('invoices').where('invoiceId', '==', '3/01/2026').get();

    for (const doc of snapshot.docs) {
        if ((doc.data().vendorName || '').toLowerCase().includes('suprun')) {
            await doc.ref.update({
                amount: 3600,
                status: 'Unpaid'
            });
            console.log(`Suprun restored!`);
        }
    }
    console.log("Done.");
    process.exit(0);
}

restoreSuprun();
