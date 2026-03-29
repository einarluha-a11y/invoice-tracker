const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = app.firestore();
async function run() {
    console.log("Checking Global Technics OÜ invoices:");
    const companies = await db.collection('companies').where('name', '==', 'Global Technics OÜ').get();
    if(companies.empty) return console.log("No company found.");
    const companyId = companies.docs[0].id;
    console.log("Company ID:", companyId);
    
    // No limit
    const snap = await db.collection('invoices').where('companyId', '==', companyId).get();
    snap.forEach(doc => {
        const d = doc.data();
        if(['DMYTRO SUPRUN', 'Terma Sp. z o.o.', 'Eesti Liinirongid AS', 'A.A. Tööriistalaenutus OÜ'].includes(d.vendorName)) {
            console.log(`- ${d.vendorName} | amount: ${d.amount} | fileUrl: ${d.fileUrl}`);
        }
    });
    process.exit(0);
}
run();
