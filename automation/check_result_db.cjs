require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function check() {
    try {
        console.log("\n--- LATEST 3 SAVED INVOICES ---");
        const recent = await db.collection('invoices').orderBy('createdAt', 'desc').limit(3).get();
        recent.forEach(doc => {
            const data = doc.data();
            console.log(`ID: ${doc.id} | Vendor: ${data.vendorName} | InvoiceNo: ${data.invoiceId} | Amount: ${data.amount} | Created: ${data.dateCreated} | Due: ${data.dueDate} | File: ${data.fileUrl ? 'YES' : 'NO'}`);
        });

        console.log("\n--- RESULT INVOICES ---");
        const result = await db.collection('invoices').where('vendorName', '==', 'Result Group OÜ').get();
        result.forEach(doc => {
            const data = doc.data();
            console.log(`ID: ${doc.id} | Vendor: ${data.vendorName} | InvoiceNo: ${data.invoiceId} | Amount: ${data.amount} | Created: ${data.dateCreated} | Due: ${data.dueDate} | File: ${data.fileUrl ? 'YES' : 'NO'} | URL: ${data.fileUrl}`);
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
