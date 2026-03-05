const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function traceBankStatement() {
    console.log('Searching for paid Ideacom invoices around Dec/Jan to trace the Bank Statement run...');

    // Let's find any Ideacom invoice that is marked as Paid
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .where('status', '==', 'Paid')
        .get();

    console.log(`Found ${snapshot.docs.length} Paid Ideacom invoices.`);

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`\nDoc ID: ${doc.id}`);
        console.log(`Vendor: ${data.vendorName}`);
        console.log(`Amount: ${data.amount}`);
        console.log(`Date Created: ${data.dateCreated}`);
    });

    process.exit(0);
}

traceBankStatement();
