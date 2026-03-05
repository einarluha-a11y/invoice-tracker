const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
    try {
        console.log('Fetching from Firestore...');
        const snapshot = await db.collection('invoices').get();
        console.log(`Found ${snapshot.size} documents in 'invoices' collection.`);
        if (!snapshot.empty) {
            console.log('Sample Document:');
            console.log(snapshot.docs[0].data());
        }
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

run();
