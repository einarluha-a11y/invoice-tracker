const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function runCleanup() {
    console.log('Fetching all invoices from Firestore to clear descriptions...');
    const snapshot = await db.collection('invoices').get();

    if (snapshot.empty) {
        console.log('No invoices found.');
        return;
    }

    let count = 0;
    const batch = db.batch();

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.description) {
            batch.update(doc.ref, {
                description: admin.firestore.FieldValue.delete()
            });
            count++;
        }
    });

    if (count > 0) {
        console.log(`Clearing description field from ${count} invoices...`);
        await batch.commit();
        console.log('🎉 Done clearing descriptions.');
    } else {
        console.log('No descriptions found to clear.');
    }
    
    process.exit(0);
}

runCleanup();
