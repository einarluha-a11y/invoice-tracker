const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function dumpInvoices() {
    console.log("Fetching pending/overdue invoices...");
    const snapshot = await db.collection('invoices').where('status', 'in', ['Pending', 'Overdue', 'Unpaid']).get();

    snapshot.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${d.invoiceId} | Vendor: ${d.vendorName} | Amount: ${d.amount} | Status: ${d.status}`);
    });
    console.log("Done.");
    process.exit(0);
}

dumpInvoices();
