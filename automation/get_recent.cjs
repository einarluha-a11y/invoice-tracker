const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function getRecentIdeacom() {
    console.log('Fetching all Ideacom invoices to sort in memory...');

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    const invoices = [];
    snapshot.forEach(doc => {
        invoices.push({ id: doc.id, data: doc.data() });
    });

    // Sort by createdAt descending
    invoices.sort((a, b) => {
        const timeA = a.data.createdAt ? a.data.createdAt.toMillis() : 0;
        const timeB = b.data.createdAt ? b.data.createdAt.toMillis() : 0;
        return timeB - timeA;
    });

    // Top 5
    const recent = invoices.slice(0, 5);
    recent.forEach(inv => {
        console.log(`\nDoc ID: ${inv.id}`);
        console.log(inv.data);
    });

    process.exit(0);
}

getRecentIdeacom();
