const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function purgeOCR() {
    console.log('[DB] Searching for bad OCR Result Group (.92)...');
    
    const snapshot = await db.collection('invoices')
        .where('vendorName', '>=', 'Result Group')
        .where('vendorName', '<=', 'Result Group\uf8ff')
        .get();

    for (const doc of snapshot.docs) {
        if (doc.data().invoiceId === '260228.92') {
            console.log(`[DB] Deleting bad OCR document ID: ${doc.id}`);
            await doc.ref.delete();
        }
    }
    console.log('[DB] Purge complete.');
}

purgeOCR().then(() => process.exit(0)).catch(console.error);
