require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkLast10Records() {
    console.log(`[Database Audit] 🔍 Fetching the 10 newest records for Ideacom...`);
    
    const snapshot = await db.collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
        
    let count = 1;
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`\n--- Record ${count}: ${doc.id} ---`);
        console.log(`Vendor       : ${data.vendorName}`);
        console.log(`Amount       : ${data.amount} ${data.currency}`);
        console.log(`Subtotal     : ${data.subtotalAmount}`);
        console.log(`Tax          : ${data.taxAmount}`);
        console.log(`Reg No       : ${data.supplierRegistration}`);
        console.log(`VAT No       : ${data.supplierVat}`);
        console.log(`Invoice ID   : ${data.invoiceId}`);
        console.log(`Status       : ${data.status}`);
        if (data.validationWarnings && data.validationWarnings.length > 0) {
            console.log(`Warnings     : ${JSON.stringify(data.validationWarnings)}`);
        }
        count++;
    });
    
    if (snapshot.empty) {
        console.log(`[Database Audit] ⚠️ No new records found yet. Background server might still be working on the prompt reflections.`);
    }
    
    process.exit(0);
}

checkLast10Records();
