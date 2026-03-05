const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function restoreEmergent() {
    console.log('Restoring miscalculated EMERGENT invoices to 50 USD Unpaid...');
    const snapshot = await db.collection('invoices').get();

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('emergent')) {
            // Restore only the ones that were squashed to ~5
            if (data.amount < 10) {
                console.log(`Restoring Invoice ${data.invoiceId} (currently ${data.amount}) back to 50 USD Unpaid...`);
                batch.update(doc.ref, {
                    amount: 50,
                    currency: 'USD',
                    status: 'Unpaid'
                });
                count++;
            }
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully restored ${count} Emergent invoices.`);
    } else {
        console.log('No Emergent invoices needed restoration!');
    }

    process.exit(0);
}

restoreEmergent();
