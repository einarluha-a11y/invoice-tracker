const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const snap = await db.collection('invoices').get();
    const matches = [];
    snap.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('dlb')) {
            matches.push({ id: doc.id, ...data });
        }
    });

    console.log(`Found ${matches.length} invoices matching "DLB":`);
    matches.sort((a,b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
    matches.slice(0, 5).forEach(m => console.log(JSON.stringify(m, null, 2)));
}
run();
