const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixDate() {
    try {
        console.log("Fixing dueDate for 260228.92 (DocID: d75sz9goPfVrPOl1529G)...");
        await db.collection('invoices').doc('d75sz9goPfVrPOl1529G').update({
            dueDate: '19-03-2026'
        });
        console.log("Updated.");
        
    } catch (e) {
        console.error(e);
    }
}
fixDate();
