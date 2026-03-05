const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkInvoice() {
    console.log('Fetching Accounting Resources OÜ invoice 6199...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .where('invoiceId', '==', '6199')
        .get();

    if (snapshot.empty) {
        console.log("Invoice 6199 not found.");
    } else {
        snapshot.forEach(doc => {
            console.log(`\nDoc ID: ${doc.id}`);
            console.log(doc.data());
        });
    }
    process.exit(0);
}

checkInvoice();
