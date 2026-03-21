require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function traceLatest() {
    const snapshot = await db.collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Document ID: ${doc.id}`);
        console.log(JSON.stringify(data, null, 2));
        console.log("----------------------");
    });
}

traceLatest();
