const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkPaidInvoice() {
    console.log('Fetching the Paid instance of Accounting Resources OÜ...');

    const docRef = db.collection('invoices').doc('4o3Afqf3EYg9AFoaQIv2');
    const doc = await docRef.get();

    if (doc.exists) {
        console.log("Found Paid Instance:");
        console.log(doc.data());
    }

    console.log('\nFetching the Unpaid instance of Accounting Resources OÜ (6199)...');

    const docRefUnpaid = db.collection('invoices').doc('RhYzEduG0kcpX1Y6glfG');
    const docUnpaid = await docRefUnpaid.get();

    if (docUnpaid.exists) {
        console.log("Found Unpaid Instance:");
        console.log(docUnpaid.data());
    }

    process.exit(0);
}

checkPaidInvoice();
