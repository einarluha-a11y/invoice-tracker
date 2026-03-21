const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const docRef = db.collection('companies').doc('vlhvA6i8d3Hry8rtrA3Z');
    const doc = await docRef.get();
    
    if (doc.exists) {
        console.log("Company data:");
        console.log(JSON.stringify(doc.data(), null, 2));
    } else {
        console.log("Company not found.");
    }
}

run();
