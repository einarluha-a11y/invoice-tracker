const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixInvoices() {
    const companies = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const companyId = companies.docs[0].id;

    const invoices = await db.collection('invoices')
        .where('companyId', '==', companyId)
        .get();

    let countDeleted = 0;

    console.log("Current Ingeen Invoices:");
    for (const doc of invoices.docs) {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('ingeen')) {
            console.log(`- ID: ${doc.id}, Amount: ${data.amount}, Due: ${data.dueDate}`);
            if (data.amount === 150) {
                await doc.ref.delete();
                console.log(`  -> DELETED hallucinated invoice ${doc.id}`);
                countDeleted++;
            }
        }
    }
    console.log(`Total deleted: ${countDeleted}`);
    process.exit(0);
}
fixInvoices();
