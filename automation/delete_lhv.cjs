const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function deleteLHV() {
    console.log('Deleting duplicate LHV Kindlustus invoice...');
    // Delete the one with uppercase 'KINDLUSTUS' or whichever, I will just hardcode the ID I found.
    const docId = 'xKeZlVGou34lQOCpuKWo';
    await db.collection('invoices').doc(docId).delete();
    console.log(`Successfully deleted duplicate doc: ${docId}`);
    process.exit(0);
}

deleteLHV();
