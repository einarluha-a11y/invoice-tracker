const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function cleanDella() {
    try {
        const snapshot = await db.collection('invoices').get();
        let deleted = 0;
        let foundAny = false;
        
        for (const doc of snapshot.docs) {
            const d = doc.data();
            const vendor = (d.vendorName || '').toLowerCase();
            
            if (vendor.includes('della')) {
                console.log(`FOUND DELLA: ID: ${d.invoiceId} | SubId: ${doc.id}`);
                foundAny = true;
                
                // If it is the receipt (2451-9417) or anything other than the exact invoice 6A8DCCA4 0002
                if (d.invoiceId && (d.invoiceId.includes('2451') || d.invoiceId.toLowerCase().includes('kviitung'))) {
                    console.log(`DELETING ERRONEOUS RECEIPT: ${doc.id}`);
                    await db.collection('invoices').doc(doc.id).delete();
                    deleted++;
                }
            }
        }
        
        if (!foundAny) console.log("No Della invoices found.");
        else console.log(`Deleted ${deleted} incorrect entries.`);
        
    } catch (e) {
        console.error(e);
    }
}
cleanDella();
