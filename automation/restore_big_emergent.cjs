const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function restoreBigEmergent() {
    console.log('Restoring the 200 USD EMERGENT invoice to Unpaid...');

    // Explicitly targeting the known 200 USD invoice by document ID
    const targetId = '3RDlxOZCT4xpB1kDEpjP';
    const docRef = db.collection('invoices').doc(targetId);

    const doc = await docRef.get();

    if (doc.exists) {
        const data = doc.data();
        console.log(`Restoring Invoice ${data.invoiceId} (currently ${data.amount} ${data.currency} ${data.status}) back to 200 USD Unpaid...`);

        await docRef.update({
            amount: 200,
            currency: 'USD',
            status: 'Unpaid'
        });
        console.log(`Successfully restored.`);
    } else {
        console.log('Invoice not found!');
    }

    process.exit(0);
}

restoreBigEmergent();
