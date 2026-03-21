const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkUrl() {
    try {
        const doc = await db.collection('invoices').doc('SXViFHJhu7x810WtRfXv').get();
        if (doc.exists) {
            console.log("fileUrl: " + doc.data().fileUrl);
        } else {
            console.log("Doc not found");
        }
    } catch (e) {
        console.error(e);
    }
}
checkUrl();
