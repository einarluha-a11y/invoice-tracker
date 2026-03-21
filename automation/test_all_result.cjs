const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkResultGroup() {
    try {
        const snapshot = await db.collection('invoices')
            .where('vendorName', '==', 'Result Group OÜ')
            .get();
            
        console.log(`Found ${snapshot.docs.length} Result Group invoices.`);
        for (const doc of snapshot.docs) {
            const data = doc.data();
            console.log(`ID: ${data.invoiceId} | Amount: ${data.amount} | Date: ${data.dateCreated} | Due: ${data.dueDate} | DocID: ${doc.id}`);
        }
    } catch (e) {
        console.error(e);
    }
}
checkResultGroup();
