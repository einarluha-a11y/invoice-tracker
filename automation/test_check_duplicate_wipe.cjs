const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
  const docId = 'upSOgzypLiH5a2l86bDl'; 
  const doc = await db.collection('invoices').doc(docId).get();
  console.log(doc.data());
}
check();
