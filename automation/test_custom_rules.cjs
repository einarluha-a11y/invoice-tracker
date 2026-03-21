const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkCustomRules() {
    const snapshot = await db.collection('companies').get();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        console.log(`Company: ${data.name}`);
        console.log(`Custom Rules: ${data.customRules || data.customAiRules || "NONE"}`);
        console.log('-----------------------------------');
    }
}
checkCustomRules();
