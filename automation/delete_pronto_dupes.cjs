const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function deleteProntoDupes() {
    console.log('Purging invalid / duplicate PRONTO invoices...');

    // We identified the following bad documents:
    const docIds = [
        'g8EeLGiUqL2XVyKZepOj', // Auto-1772615558610 (Invalid document, likely CMR)
        'acYlfybqU74TOCMQjzfU', // 21-22 Unpaid (Duplicate of pl21-22 Unpaid)
        'uaWtmdDuMt3qOn4itsHx', // pl21-13 Unpaid (Duplicate of 21-13 Paid)
        'BghNOqVWkhQEy0zsDtNe'  // pl21-21 Unpaid (Duplicate of 21-21 Paid)
    ];

    const batch = db.batch();
    for (const docId of docIds) {
        batch.delete(db.collection('invoices').doc(docId));
        console.log(`Queued deletion for doc: ${docId}`);
    }

    await batch.commit();
    console.log(`Successfully purged ${docIds.length} duplicate/invalid PRONTO invoices.`);
    process.exit(0);
}

deleteProntoDupes();
