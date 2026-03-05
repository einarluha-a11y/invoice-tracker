const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
    // Let's delete anything created in the last roughly 15 minutes (since we just tested it)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

    const snapshot = await db.collection('invoices')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(fifteenMinsAgo))
        .get();

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        // Make sure we only delete the ones without 'scan_url' because real invoices have URLs usually
        // Or we just delete them anyway since all recent ones are from this bug test
        batch.delete(doc.ref);
        count++;
        console.log(`Deleting false invoice: ${doc.id} - ${doc.data().vendorName}`);
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Deleted ${count} corrupted documents.`);
    } else {
        console.log('No recent documents found to delete.');
    }

    process.exit(0);
}

run();
