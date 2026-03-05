const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function backfillCompanyId() {
    console.log('Backfilling missing companyId to all old invoices...');

    // The specific Company ID for Global Technics OU
    const globalTechnicsId = 'bP6dc0PMdFtnmS5QTX4N';

    const invoicesRef = db.collection('invoices');
    let updatedCount = 0;

    const snapshot = await invoicesRef.get();

    const batch = db.batch();

    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.companyId) {
            batch.update(doc.ref, { companyId: globalTechnicsId });
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        console.log(`Updating ${updatedCount} invoices with companyId: ${globalTechnicsId}...`);
        await batch.commit();
        console.log('Successfully backfilled invoices!');
    } else {
        console.log('No invoices needed updating.');
    }

    process.exit(0);
}

backfillCompanyId();
