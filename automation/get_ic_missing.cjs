const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function getMissingIds() {
    console.log("Checking missing files for Ideacom...");
    const snap = await db.collection('invoices').where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z').get();
    snap.forEach(d => {
        const dt = d.data();
        if (!dt.fileUrl) {
            console.log(`ID: '${d.id}', Vendor: '${dt.vendorName}'`);
        }
    });
    process.exit(0);
}
getMissingIds();
