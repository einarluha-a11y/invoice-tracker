const admin = require("firebase-admin");
const serviceAccount = require("./google-credentials.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function query() {
    const snapshot = await db.collection("invoices")
        .where("vendorName", "==", "DeepL SE")
        .limit(10)
        .get();
        
    snapshot.forEach(doc => {
        console.log("DeepL SE =>", doc.id, "=>", doc.data());
    });
    
    const snapshot2 = await db.collection("invoices")
        .where("vendorName", "==", "DeepL")
        .limit(10)
        .get();
    
    snapshot2.forEach(doc => {
        console.log("DeepL =>", doc.id, "=>", doc.data());
    });
}

query().catch(console.error).finally(() => process.exit(0));
