require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const snap = await db.collection('companies').where('name', '==', 'Ideacom OÜ').get();
    if (snap.empty) {
        console.log("Ideacom not found.");
        return;
    }
    const docId = snap.docs[0].id;
    await db.collection('companies').doc(docId).update({
        zapierWebhookUrl: "https://hooks.zapier.com/hooks/catch/26719164/uxu5kvy/"
    });
    console.log("Zapier webhook added to Ideacom in Firestore.");
}
run();
