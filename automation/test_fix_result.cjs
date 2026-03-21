const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function cleanResultGroup() {
    try {
        console.log("Deleting bad invoice 6305321900 (DocID: hlJrwADMIMXuHPnBpUKv)...");
        await db.collection('invoices').doc('hlJrwADMIMXuHPnBpUKv').delete();
        console.log("Deleted.");
        
        console.log("Fixing Date format for 260228.92 (DocID: d75sz9goPfVrPOl1529G)...");
        await db.collection('invoices').doc('d75sz9goPfVrPOl1529G').update({
            dateCreated: '28-02-2026',
            dueDate: '16-02-2026'
        });
        console.log("Updated.");
        
    } catch (e) {
        console.error(e);
    }
}
cleanResultGroup();
