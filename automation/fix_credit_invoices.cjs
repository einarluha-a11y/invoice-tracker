const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixNegativeInvoices() {
    console.log('Scanning database for Unpaid negative credit invoices...');
    const snapshot = await db.collection('invoices').get();

    const batch = db.batch();
    let updateCount = 0;

    snapshot.forEach(doc => {
        const data = doc.data();

        // If it's a negative amount (Credit) and it's NOT Paid, we mark it Paid
        // because Credit invoices inherently balance out and don't require fiat payment.
        if (data.amount < 0 && data.status !== 'Paid') {
            console.log(`Fixing retroactive credit invoice: ${data.vendorName} - ${data.invoiceId} (Amount: ${data.amount})`);
            batch.update(doc.ref, { status: 'Paid' });
            updateCount++;
        }
    });

    if (updateCount > 0) {
        await batch.commit();
        console.log(`Successfully marked ${updateCount} credit invoices as Paid.`);
    } else {
        console.log('No unpaid credit invoices found!');
    }

    process.exit(0);
}

fixNegativeInvoices();
