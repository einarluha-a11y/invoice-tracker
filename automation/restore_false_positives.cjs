const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function restoreFalsePositives() {
    console.log('Restoring Estma Terminaali and Konica Minolta...');

    // We target the specific latest invoices mentioned by the user
    // Estma: 40176
    // Konica: EES048769

    const estmaSnapshot = await db.collection('invoices').where('invoiceId', '==', '40176').get();
    const konicaSnapshot = await db.collection('invoices').where('invoiceId', '==', 'EES048769').get();

    const batch = db.batch();
    let count = 0;

    estmaSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Restoring Estma Invoice ${data.invoiceId} (currently ${data.status}) back to Unpaid...`);
        batch.update(doc.ref, { status: 'Unpaid' });
        count++;
    });

    konicaSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Restoring Konica Invoice ${data.invoiceId} (currently ${data.status}) back to Unpaid...`);
        batch.update(doc.ref, { status: 'Unpaid' });
        count++;
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully restored ${count} invoices.`);
    } else {
        console.log('Invoices not found!');
    }

    process.exit(0);
}

restoreFalsePositives();
