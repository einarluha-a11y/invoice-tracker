const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkProntoData() {
    try {
        const snapshot = await db.collection('invoices').get();
        console.log(`Searching for PRONTO variations...`);
        let found = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const vendor = (data.vendorName || '').toLowerCase();

            if (vendor.includes('pronto')) {
                console.log(`[FOUND PRONTO] ID: ${data.invoiceId} | Vendor: "${data.vendorName}" | Date: ${data.dateCreated} | Due: ${data.dueDate}`);
                found++;
            }
        }

        console.log(`Total Pronto invoices: ${found}`);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkProntoData();
