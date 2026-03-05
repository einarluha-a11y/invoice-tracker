const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkInvoice() {
    try {
        const snapshot = await db.collection('invoices').get();
        let found = false;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const idLower = (data.invoiceId || '').toLowerCase();
            const vendorLower = (data.vendorName || '').toLowerCase();

            if (vendorLower.includes('omega') || idLower.includes('260200153')) {
                console.log(`\n[DB RECORD FOUND]`);
                console.log(`ID: ${data.invoiceId}`);
                console.log(`Vendor: ${data.vendorName}`);
                console.log(`Amount: ${data.amount} ${data.currency}`);
                console.log(`Created: ${data.dateCreated}`);
                console.log(`Due: ${data.dueDate}`);
                console.log(`Status: ${data.status}`);
                found = true;
            }
        }

        if (!found) console.log("No invoice found matching Omega or 260200153.");
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkInvoice();
