const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkPronto() {
    console.log('Fetching all PRONTO Sp. z o. o. invoices...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    const prontoInvoices = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toUpperCase().includes('PRONTO')) {
            prontoInvoices.push({ id: doc.id, data: data });
        }
    });

    // Sort by amount and date to easily spot duplicates
    prontoInvoices.sort((a, b) => a.data.amount - b.data.amount);

    prontoInvoices.forEach(inv => {
        console.log(`\nDoc ID: ${inv.id}`);
        console.log(`Invoice ID: ${inv.data.invoiceId}`);
        console.log(`Amount: ${inv.data.amount} EUR`);
        console.log(`Date Created: ${inv.data.dateCreated}`);
        console.log(`Status: ${inv.data.status}`);
    });

    process.exit(0);
}

checkPronto();
