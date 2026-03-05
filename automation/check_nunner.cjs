const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkNunner() {
    console.log('Searching for NUNNER Logistics UAB invoices without composite indexing...');

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    let found = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toUpperCase().includes('NUNNER')) {
            console.log(`\nDoc ID: ${doc.id}`);
            console.log(data);
            found++;
        }
    });
    console.log(`\nTotal found: ${found}`);

    process.exit(0);
}

checkNunner();
