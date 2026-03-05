const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function deleteAcctDupe() {
    console.log('Deleting Unpaid duplicate Accounting Resources invoice 6199...');

    // The unpaid clone
    const docId = 'RhYzEduG0kcpX1Y6glfG';
    await db.collection('invoices').doc(docId).delete();

    console.log(`Successfully deleted doc: ${docId}`);
    process.exit(0);
}

deleteAcctDupe();
