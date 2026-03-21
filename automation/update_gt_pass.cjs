const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function updatePassword() {
    const compId = 'bP6dc0PMdFtnmS5QTX4N'; // Global Technics
    console.log(`Updating password for company ${compId}...`);
    
    await db.collection('companies').doc(compId).update({
        imapPassword: '83Gl92tecH42!'
    });

    console.log("Database updated successfully!");
    process.exit();
}

updatePassword();
