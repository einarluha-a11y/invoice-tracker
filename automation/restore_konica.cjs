const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function restoreKonica() {
    console.log('Restoring Konica Minolta invoice EES048769 to Unpaid...');

    const snapshot = await db.collection('invoices').where('invoiceId', '==', 'EES048769').get();

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Restoring Invoice ${data.invoiceId} (currently ${data.status}) back to Unpaid...`);
        batch.update(doc.ref, {
            status: 'Unpaid'
        });
        count++;
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully restored ${count} Konica invoices.`);
    } else {
        console.log('Invoice not found!');
    }

    process.exit(0);
}

restoreKonica();
