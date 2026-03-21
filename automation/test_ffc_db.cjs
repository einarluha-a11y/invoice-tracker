const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
    try {
        const snapshot = await db.collection('invoices').get();
        let found = false;
        snapshot.forEach(doc => {
            const d = doc.data();
            const vendor = (d.vendorName || '').toLowerCase();
            if (vendor.includes('ffc')) {
                console.log(`FOUND FFC: ID: ${d.invoiceId} | Vendor: ${d.vendorName} | Amount: ${d.amount} | DateCreated: ${d.dateCreated} | CreatedAt: ${d.createdAt?.toDate().toISOString()} | SubId: ${doc.id}`);
                found = true;
            }
        });
        if (!found) console.log("No FFC invoices found in entire DB.");
    } catch (e) {
        console.error(e);
    }
}
run();
