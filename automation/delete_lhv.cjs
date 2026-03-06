const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteDocs() {
    const snapshot = await db.collection('invoices').where('invoiceId', '==', '112443348').get();

    if (snapshot.empty) {
        console.log('No matching documents.');
        process.exit(0);
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        console.log(`Deleting ${doc.id} - ${doc.data().vendorName}`);
        batch.delete(doc.ref);
    });

    await batch.commit();
    console.log('Successfully deleted the policy records.');
    process.exit(0);
}

deleteDocs();
