const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixWurth() {
    console.log('Fixing AS WÜRTH Credit Invoice and Triggering Offset...');

    // The specific credit invoice
    const creditInvoiceId = '5123025269';

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.where('invoiceId', '==', creditInvoiceId).get();

    if (snapshot.empty) {
        console.log('Could not find the credit invoice.');
        process.exit(0);
    }

    const creditDoc = snapshot.docs[0];
    const data = creditDoc.data();

    console.log(`Loading Credit Invoice: ${data.vendorName} | Current Amount: ${data.amount}`);

    const targetAmount = 152.33;

    // Force credit doc to negative and paid
    console.log('Converting to Negative Credit Invoice...');
    await creditDoc.ref.update({
        amount: -targetAmount,
        status: 'Paid'
    });

    // Now look for its counterpart (the original positive invoice)
    // Avoid double index query error by just getting all WURTH and manually filtering
    const counterpartSnapshot = await invoicesRef
        .where('vendorName', '==', data.vendorName)
        .get();

    let offsetFound = false;

    for (const doc of counterpartSnapshot.docs) {
        const pData = doc.data();
        if (pData.status !== 'Paid' && Math.abs((pData.amount || 0) - targetAmount) <= 0.05) {
            console.log(`Found Matching Original Invoice ${pData.invoiceId} for ${pData.amount}. Auto-Offsetting...`);
            await doc.ref.update({ status: 'Paid' });
            offsetFound = true;
            break;
        }
    }

    if (!offsetFound) {
        console.log('Could not find a matching positive invoice to offset against!');
    } else {
        console.log('Successfully offset both invoices!');
    }

    process.exit(0);
}

fixWurth();
