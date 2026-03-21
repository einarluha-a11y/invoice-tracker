const admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
  const query = await db.collection('invoices').orderBy('createdAt', 'desc').limit(50).get();
  
  query.forEach(doc => {
      const data = doc.data();
      const lower = (data.vendorName || '').toLowerCase();
      if (lower.includes('result') || lower.includes('ffc')) {
          console.log(`--- [${doc.id}] ${data.vendorName} ---`);
          console.log(`Invoice ID: '${data.invoiceId}'`);
          console.log(`Date      : '${data.dateCreated}'`);
          console.log(`Amount    : '${data.amount}'`);
          console.log(`Company   : '${data.companyId}'`);
      }
  });
  process.exit(0);
}
check();
