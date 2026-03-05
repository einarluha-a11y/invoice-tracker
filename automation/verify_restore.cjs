const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkIdeacomCount() {
    console.log('Counting Ideacom invoices...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z') // Ideacom's DB ID
        .get();

    console.log(`There are currently ${snapshot.size} invoices in the database for Ideacom OÜ.`);

    // Check specific IDs that were missing
    const ids = ['2512H212', '2601H212', '2602H212'];
    for (const id of ids) {
        const check = snapshot.docs.find(d => d.data().invoiceId === id);
        if (check) {
            console.log(`Fixed invoice found: ${id} mapped to vendor: ${check.data().vendorName}`);
        } else {
            console.log(`Invoice STILL missing: ${id}`);
        }
    }

    process.exit(0);
}

checkIdeacomCount();
