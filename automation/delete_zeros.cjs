const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function deleteZeros() {
    console.log('Deleting 0 EUR fallback invoices...');
    const docIds = ['AhGJPMc7F5R4yeMlUxc7', 'NbsLCgkelAfRJKR21Lg4', 'UA2WlnMb5tbXF9okEOLD', 'BQaQ6dk3dDjU8jLmmtF7'];

    const batch = db.batch();
    for (const docId of docIds) {
        batch.delete(db.collection('invoices').doc(docId));
        console.log(`Queued deletion for doc: ${docId}`);
    }

    await batch.commit();
    console.log(`Successfully purged ${docIds.length} zero-sum fallback invoices.`);
    process.exit(0);
}

deleteZeros();
