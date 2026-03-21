require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function traceUserInvoices() {
    console.log(`[Database Audit] 🔍 Fetching the specific invoices from the user's screenshot...`);
    
    const snapshot = await db.collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
        
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.invoiceId === 'pl21-29' || data.vendorName.includes('FFC') || data.vendorName.includes('ФФК')) {
            console.log(`\n--- Record: ${doc.id} ---`);
            console.log(`Vendor       : ${data.vendorName}`);
            console.log(`Invoice ID   : ${data.invoiceId}`);
            console.log(`Amount       : ${data.amount} ${data.currency}`);
            console.log(`Reg No       : '${data.supplierRegistration}'`);
            console.log(`VAT No       : '${data.supplierVat}'`);
            console.log(`Warnings     : ${JSON.stringify(data.validationWarnings)}`);
        }
    });
    
    process.exit(0);
}

traceUserInvoices();
