const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = app.firestore();

async function run() {
    console.log("Checking specific problematic invoices...");
    const snap = await db.collection('invoices')
        .where('vendorName', 'in', ['DMYTRO SUPRUN', 'Terma Sp. z o.o.', 'A.A. Tööriistalaenutus OÜ'])
        .get();
        
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`- ${doc.id} | Vendor: ${data.vendorName} | fileUrl: ${data.fileUrl} | fileUrl Type: typeof ${typeof data.fileUrl}`);
    });
    
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
