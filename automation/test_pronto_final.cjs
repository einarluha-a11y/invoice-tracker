const admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('invoices')
    .where('invoiceId', 'in', ['PL21-28', 'pl21-28', '21-28', 'PL21-29', 'pl21-29', '21-29', '21.29'])
    .get();
  
  if(!snapshot.empty) {
    console.log('\n✅ FOUND INVOICES IN FIRESTORE:');
    snapshot.forEach(doc => {
        let d = doc.data();
        console.log(`[${d.companyId}] ${d.vendorName} | Inv: ${d.invoiceId} | Amount: ${d.amount} | Status: ${d.status}`);
    });
  } else {
    console.log('Still parsing...');
  }
  process.exit(0);
}
check();
