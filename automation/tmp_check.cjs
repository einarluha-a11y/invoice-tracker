const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = app.firestore();

async function run() {
    const snap = await db.collection('invoices').where('status', '==', 'NEEDS_REVIEW').get();
    console.log(`Found ${snap.size} quarantine records.`);
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`--- [${doc.id}] ${data.vendorName} | ${data.amount} ${data.currency} ---`);
        console.log(`Warnings:\n`, data.validationWarnings?.join('\n') || 'No warnings array attached');
        console.log('\n');
    });
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
