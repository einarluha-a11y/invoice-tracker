const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkCargo() {
    console.log('Searching for Cargo Solutions invoices in the database...');

    // Scan all Ideacom invoices
    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    let count = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toUpperCase().includes('CARGO SOLUTIONS')) {
            console.log(`\nDoc ID: ${doc.id}`);
            console.log(data);
            count++;
        }
    });

    console.log(`Total Cargo Solutions invoices found: ${count}`);
    process.exit(0);
}

checkCargo();
