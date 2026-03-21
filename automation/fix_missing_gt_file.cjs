const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function inspectGlobalTechnicsInvoice() {
    console.log("Looking for recent Re-Est invoices...");
    const invoicesRef = db.collection('invoices');
    const q = await invoicesRef
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

    q.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.includes('Re-Est')) {
            console.log(`\nDoc ID: ${doc.id}`);
            console.log(`Vendor: ${data.vendorName}`);
            console.log(`Amount: ${data.amount}`);
            console.log(`Status: ${data.status}`);
            console.log(`FileUrl: ${data.fileUrl}`);
            console.log(`Company ID: ${data.companyId}`);
        }
    });
    process.exit();
}

inspectGlobalTechnicsInvoice();
