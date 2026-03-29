const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = app.firestore();
async function run() {
    const snap = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    const id = snap.docs[0].id;
    const invs = await db.collection('invoices').where('companyId', '==', id).limit(5).get();
    invs.forEach(d => console.log(d.data().vendorName, d.data().fileUrl));
    process.exit(0);
}
run();
