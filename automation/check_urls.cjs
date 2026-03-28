const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = app.firestore();

async function run() {
    console.log("Checking 10 NEWEST invoices for fileUrl...");
    const snap = await db.collection('invoices').orderBy('createdAt', 'desc').limit(10).get();
    let withFile = 0;
    let withoutFile = 0;
    snap.forEach(doc => {
        const data = doc.data();
        if (data.fileUrl) withFile++;
        else withoutFile++;
        console.log(`- ${doc.id} | ${data.vendorName} | status: ${data.status} | fileUrl: ${data.fileUrl ? 'YES' : 'NO'}`);
    });
    console.log(`\nTOTAL: ${withFile} have fileUrl, ${withoutFile} do not.`);
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
