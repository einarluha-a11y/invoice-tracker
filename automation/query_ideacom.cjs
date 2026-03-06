require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function queryIdeacom() {
    const companiesRef = db.collection('companies');
    const compSnap = await companiesRef.where('name', '==', 'Ideacom OÜ').get();
    if(compSnap.empty) return;
    const companyId = compSnap.docs[0].id;

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef
        .where('companyId', '==', companyId)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

    console.log("Recent Ideacom Invoices:");
    snapshot.docs.forEach(doc => {
        const d = doc.data();
        console.log(`[${doc.id}] vendor: ${d.vendorName}, amount: ${d.amount}, date: ${d.dateCreated}, due: ${d.dueDate}, fileUrl: ${!!d.fileUrl}`);
    });
}
queryIdeacom();
