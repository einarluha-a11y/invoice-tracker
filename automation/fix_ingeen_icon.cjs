require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function fixIcon() {
    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef
        .where('vendorName', '==', 'INGEEN TRANSPORT OÜ')
        .where('amount', '==', 1488.00)
        .get();

    if (snapshot.empty) {
        console.log('No matching invoices found for Ingeen 1488.');
        return;
    }

    let batch = db.batch();
    snapshot.docs.forEach(doc => {
        console.log(`Fixing invoice: ${doc.id}`);
        batch.update(doc.ref, {
            fileUrl: "https://firebasestorage.googleapis.com/v0/b/invoice-tracker-xyz.appspot.com/o/invoices%2Ftest_company%2F1772805992577_test_upload.pdf?alt=media&token=ba436d61-26b6-4e82-a9fe-be273248bd68"
        });
    });

    await batch.commit();
    console.log('Successfully injected fileUrl.');
}
fixIcon();
