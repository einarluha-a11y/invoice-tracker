const admin = require('firebase-admin');
const serviceAccount = require('./automation/google-credentials.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('invoices').where('vendorName', '>=', '1A').where('vendorName', '<=', '1A\uf8ff').get();
  snapshot.forEach(doc => {
    console.log(doc.id, doc.data());
  });
  
  // also check without case
  const snap2 = await db.collection('invoices').where('vendorName', '==', '1A Rehvid OÜ').get();
  snap2.forEach(doc => console.log(doc.id, doc.data()));
}
check();
