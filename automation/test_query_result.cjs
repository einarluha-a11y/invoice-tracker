const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkResultGroup() {
    try {
        const snapshot = await db.collection('invoices')
            .where('invoiceId', '==', '6305321900')
            .get();
            
        if (snapshot.empty) {
            console.log("No Result Group invoice 6305321900 found.");
            return;
        }
        
        for (const doc of snapshot.docs) {
            console.log(JSON.stringify(doc.data(), null, 2));
        }
    } catch (e) {
        console.error(e);
    }
}
checkResultGroup();
