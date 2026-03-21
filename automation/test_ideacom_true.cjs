require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkActualIdeacomTest() {
    console.log(`[Database Audit] 🔍 Let's look at the ACTUAL 10 Ideacom invoices that just finished processing...`);
    
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
        console.log(`Reg No       : '${data.supplierRegistration}'`);
        console.log(`VAT No       : '${data.supplierVat}'`);
        console.log(`Status       : ${data.status}`);
        if (data.createdAt) {
            console.log(`Created At   : ${data.createdAt._seconds ? new Date(data.createdAt._seconds * 1000).toISOString() : data.createdAt}`);
        }
        if (data.validationWarnings && data.validationWarnings.length > 0) {
            console.log(`Warnings     : ${JSON.stringify(data.validationWarnings)}`);
        }
        count++;
    });
    
    process.exit(0);
}

checkActualIdeacomTest();
