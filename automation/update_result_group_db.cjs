const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixResultGroup() {
    console.log('[DB] Searching for Result Group invoices...');
    
    // We search by vendorName prefix just in case OCR added a space initially
    const snapshot = await db.collection('invoices')
        .where('vendorName', '>=', 'Result Group')
        .where('vendorName', '<=', 'Result Group\uf8ff')
        .get();

    const perfectData = {
        invoiceId: "260228.9",
        vendorName: "Result Group OÜ",
        amount: 18.6,
        taxAmount: 3.6,
        subtotalAmount: 15, // Calculated fallback explicitly injected
        currency: "EUR",
        dateCreated: "2026-02-28", // Fixed ISO Date
        dueDate: "2026-03-19",     // Fixed ISO Date
        status: "Unpaid",
        lineItems: [
          {
            description: "Päringud (tolliinfo): CH/6305321900 / 16.02.2026 CH/54072011 / 17.02.2026",
            amount: 10
          }
        ],
        validationWarnings: []
    };

    if (snapshot.empty) {
        console.log('[DB] No existing Result Group invoice found. Creating a new one...');
        await db.collection('invoices').add({
            ...perfectData,
            companyId: 'bP6dc0PMdFtnmS5QTX4N', // Default to Global Technics
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('[DB] Successfully created perfect Result Group invoice!');
    } else {
        console.log(`[DB] Found ${snapshot.size} existing invoice(s). Updating with perfect data...`);
        let count = 0;
        for (const doc of snapshot.docs) {
            await doc.ref.update(perfectData);
            count++;
        }
        console.log(`[DB] Successfully updated ${count} record(s)!`);
    }
}

fixResultGroup().then(() => process.exit(0)).catch(console.error);
