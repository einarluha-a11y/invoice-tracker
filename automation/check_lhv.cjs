const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkLHV() {
    console.log('Searching for duplicate LHV invoices...');

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.where('invoiceId', '==', '119294474').get();

    if (snapshot.empty) {
        console.log("Invoice 119294474 not found.");
    } else {
        console.log(`Found ${snapshot.docs.length} copies of invoice 119294474.`);
        snapshot.forEach(doc => {
            console.log(`\nDoc ID: ${doc.id}`);
            console.log(doc.data());
        });
    }

    process.exit(0);
}

checkLHV();
