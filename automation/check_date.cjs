require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const doc = await db.collection('invoices').doc('2XNYSQixZyITrQENurxw').get();
    if(doc.exists) {
        console.log("CreatedAt:", doc.data().createdAt?.toDate());
    } else {
        console.log("Does not exist");
    }
}
run();
