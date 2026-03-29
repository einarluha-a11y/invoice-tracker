const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = app.firestore();
async function run() {
    const i = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const g = await db.collection('companies').where('name', '==', 'Global Technics OÜ').get();
    const idI = i.docs[0].id;
    const idG = g.docs[0].id;

    console.log("=== IDEACOM INVOICES ===");
    const sI = await db.collection('invoices').where('companyId', '==', idI).limit(20).get();
    let foundI;
    sI.forEach(d => { if(d.data().fileUrl && !foundI) foundI = d.data(); });
    console.log(foundI ? Object.keys(foundI) : "none");

    console.log("\n=== GLOBAL TECHNICS INVOICES ===");
    const sG = await db.collection('invoices').where('companyId', '==', idG).limit(20).get();
    let foundG;
    sG.forEach(d => { if(d.data().vendorName === 'DMYTRO SUPRUN' && !foundG) foundG = d.data(); });
    console.log(foundG ? Object.keys(foundG) : "none");

    process.exit(0);
}
run();
