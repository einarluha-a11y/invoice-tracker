const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function deleteDuplicates() {
    console.log('Scanning database for ALL duplicate invoices...');
    const snapshot = await db.collection('invoices').get();

    // Group by unique signature (vendorName + invoiceId)
    const seenMap = {};
    const deleteBatch = db.batch();
    let deleteCount = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.vendorName || !data.invoiceId) return;

        // Skip those without proper IDs (prevent deleting random Auto- generation ones)
        if (String(data.invoiceId).startsWith('Auto-')) return;

        const signature = `${data.vendorName}_${data.invoiceId}`.toLowerCase().trim();

        if (!seenMap[signature]) {
            // First time seeing this invoice, mark as safe
            seenMap[signature] = doc.id;
        } else {
            // It's a duplicate! Delete it.
            console.log(`Deleting duplicate: ${data.vendorName} - ${data.invoiceId} (ID: ${doc.id})`);
            deleteBatch.delete(doc.ref);
            deleteCount++;
        }
    });

    if (deleteCount > 0) {
        await deleteBatch.commit();
        console.log(`Successfully deleted ${deleteCount} duplicate invoices from the database.`);
    } else {
        console.log('No duplicates found!');
    }

    process.exit(0);
}

deleteDuplicates();
