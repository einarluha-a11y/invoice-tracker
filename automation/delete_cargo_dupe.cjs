const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function deleteMislabeledCargo() {
    console.log('Deleting mislabeled Cargo Solutions invoice...');

    // The invoice that got named 'GLOBAL TECHNICS OÜ'
    const docId = 'ZYTLVCM6vg3LMFiIRgcz';
    await db.collection('invoices').doc(docId).delete();

    console.log(`Successfully deleted doc: ${docId}`);
    process.exit(0);
}

deleteMislabeledCargo();
