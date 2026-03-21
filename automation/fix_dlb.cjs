const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const docRef = db.collection('invoices').doc('blbqZaoI334lxGMYtu8c');
    const doc = await docRef.get();
    
    if (doc.exists) {
        const data = doc.data();
        console.log(`Updating DLB Trading Invoice (ID: ${doc.id}). Current dueDate: ${data.dueDate}, dateCreated: ${data.dateCreated}`);
        
        // Update dueDate to match dateCreated
        await docRef.update({
            dueDate: data.dateCreated
        });
        
        console.log(`Successfully updated dueDate to: ${data.dateCreated}`);
    } else {
        console.log("Invoice not found.");
    }
}

run();
