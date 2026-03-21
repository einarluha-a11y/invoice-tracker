const admin = require("firebase-admin");
const serviceAccount = require("./google-credentials.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function getPass() {
    const doc = await db.collection("companies").doc("bP6dc0PMdFtnmS5QTX4N").get(); // Global Technics ID from earlier
    const data = doc.data();
    console.log(`User: ${data.imapUser}`);
    console.log(`Pass Length: ${data.imapPassword ? data.imapPassword.length : 'none'}`);
    console.log(data.imapPassword); 
}
getPass().catch(console.error).finally(() => process.exit(0));
