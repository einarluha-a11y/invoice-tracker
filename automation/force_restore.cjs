const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function forceRestore() {
    console.log('Force Restoring Estma Terminaali and Konica Minolta...');

    // Exact IDs expected
    const estmaId = '40176';
    const konicaId = 'EES048769';

    const snapshot = await db.collection('invoices').get();
    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.invoiceId === estmaId || data.invoiceId === konicaId) {
            console.log(`Found Invoice: ${data.vendorName} - ${data.invoiceId} | Current Status: ${data.status}`);
            batch.update(doc.ref, { status: 'Unpaid' });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully force-restored ${count} invoices to Unpaid.`);
    } else {
        console.log('Invoices not found in the database!');
    }

    process.exit(0);
}

forceRestore();
