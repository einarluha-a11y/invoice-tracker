const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = app.firestore();
async function run() {
    const i = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const g = await db.collection('companies').where('name', '==', 'Global Technics OÜ').get();
    const idI = i.docs[0].id;
    const idG = g.docs[0].id;

    console.log("=== IDEACOM INVOICE ===");
    const sI = await db.collection('invoices').where('companyId', '==', idI).where('fileUrl', '>=', '').limit(1).get();
    console.log(sI.docs[0].data());

    console.log("\n=== GLOBAL TECHNICS INVOICE ===");
    const sG = await db.collection('invoices').where('companyId', '==', idG).where('vendorName', '==', 'Terma Sp. z o.o.').limit(1).get();
    console.log(sG.docs[0].data());

    process.exit(0);
}
run();
