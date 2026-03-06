const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkInvoice() {
    console.log("Fetching recent invoices for Ideacom...");
    // Find Ideacom company ID
    const companies = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    if (companies.empty) {
        console.log("Ideacom not found");
        process.exit(1);
    }
    const companyId = companies.docs[0].id;

    const invoices = await db.collection('invoices')
        .where('companyId', '==', companyId)
        .get();

    invoices.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.includes('Ingeen')) {
            console.log("INVOICE FOUND:", JSON.stringify(data, null, 2));
        }
    });

    process.exit(0);
}

checkInvoice();
