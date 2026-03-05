const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function cleanSelfIssuedInvoices() {
    console.log('Searching for rogue self-issued invoices by IDEACOM OÜ...');

    const invoicesRef = db.collection('invoices');
    let deletedCount = 0;

    const snapshot = await invoicesRef.get();

    const batch = db.batch();

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toUpperCase().includes('IDEACOM')) {
            console.log(`Found rogue invoice: ${data.invoiceId} (${data.amount} EUR) with vendor Name ${data.vendorName}. Deleting.`);
            batch.delete(doc.ref);
            deletedCount++;
        }
    });

    if (deletedCount > 0) {
        console.log(`Deleting ${deletedCount} rogue invoices...`);
        await batch.commit();
        console.log('Successfully cleaned up the database!');
    } else {
        console.log('No rogue self-issued invoices found.');
    }

    process.exit(0);
}

cleanSelfIssuedInvoices();
