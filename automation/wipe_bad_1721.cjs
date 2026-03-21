require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function wipe() {
  const ids = ['QX8saMDJz3hHKquohvMB', '2BGVPyVlG2zImwkUPGR4', 'BGd0eWZdPM4rTnvVm2WG', 'lJg6CtHuevSWJ8BMKPE9', '6pTqNMGSpHneZqiMaK9s', 'QaGSYiQt2nJ3gU9WEgeP', 'GuNKmW6FF67RUyHAugfY', 'uYl4d0UDlTDxB64QxWui'];
  for (let id of ids) {
    await db.collection('invoices').doc(id).delete();
    console.log('Deleted', id);
  }
  process.exit(0);
}
wipe();
