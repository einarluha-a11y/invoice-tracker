const admin = require('firebase-admin');
const serviceAccount = require('./automation/google-credentials.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection('invoices').where('vendorName', '>=', 'Hydroscand').where('vendorName', '<=', 'Hydroscand\uf8ff').get();
  snapshot.forEach(doc => {
    console.log(doc.id, '=>', doc.data());
  });
  process.exit(0);
}

run();
