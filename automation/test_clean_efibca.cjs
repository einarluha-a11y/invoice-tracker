const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function cleanEFIBCA() {
    try {
        const snapshot = await db.collection('invoices').get();
        let deleted = 0;
        let foundAny = false;
        
        for (const doc of snapshot.docs) {
            const d = doc.data();
            const vendor = (d.vendorName || '').toLowerCase();
            
            // Delete invoice from EFIBCA
            if (vendor.includes('efibca')) {
                console.log(`FOUND EFIBCA: ID: ${d.invoiceId} | SubId: ${doc.id}`);
                foundAny = true;
                
                console.log(`DELETING ERRONEOUS EFIBCA INVOICE: ${doc.id}`);
                await db.collection('invoices').doc(doc.id).delete();
                deleted++;
            }
        }
        
        if (!foundAny) console.log("No EFIBCA invoices found.");
        else console.log(`Deleted ${deleted} incorrect entries.`);
        
    } catch (e) {
        console.error(e);
    }
}
cleanEFIBCA();
