const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkCompanyId() {
    console.log('Checking first 5 invoices for companyId...');

    const snapshot = await db.collection('invoices').limit(5).get();

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Invoice ${data.invoiceId} (${data.vendorName}): companyId = ${data.companyId}`);
    });

    // Also fetch the Global Technics company ID
    const compSnapshot = await db.collection('companies').where('name', '==', 'Global Technics OU').get();
    compSnapshot.forEach(doc => {
        console.log(`Global Technics OU real ID: ${doc.id}`);
    });

    process.exit(0);
}

checkCompanyId();
