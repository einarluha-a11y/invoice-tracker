require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('invoices')
        .where('vendorName', '==', 'Ingeen Transport OU')
        .get();

    console.log("Ingeen Invoices:");
    snapshot.docs.forEach(doc => {
        const d = doc.data();
        console.log(`[${doc.id}] vendor: ${d.vendorName}, amount: ${d.amount}, date: ${d.dateCreated}, due: ${d.dueDate}, fileUrl: ${!!d.fileUrl}`);
    });
}
run();
