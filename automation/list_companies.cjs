const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function listCompanies() {
    console.log('Listing all companies:');

    const snapshot = await db.collection('companies').get();

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Company ID: ${doc.id} | Name: ${data.name}`);
    });

    process.exit(0);
}

listCompanies();
