const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkVendors() {
    console.log('Fetching all Ideacom vendor names from Firestore...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    const vendors = new Set();
    snapshot.forEach(doc => {
        vendors.add(doc.data().vendorName);
    });

    console.log('--- VENDORS FOUND ---');
    Array.from(vendors).sort().forEach(v => console.log(v));
    process.exit(0);
}

checkVendors();
