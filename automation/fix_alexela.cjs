const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixAlexela() {
    console.log('Searching for Alexela invoice...');

    // The specific Company ID for Ideacom OÜ is bP6dc0PMdFtnmS5QTX4N ? No, let's query all.
    // Wait, the user said they added Ideacom OU and 51 invoices.

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.where('invoiceId', '==', '206181001-26021').get();

    if (snapshot.empty) {
        console.log("Invoice 206181001-26021 not found.");
    } else {
        snapshot.forEach(async (doc) => {
            console.log(`Found invoice! Current data:`, doc.data());
            // We want to fix the dateCreated to '28.02.X' where X is the year, let's see what the current year is on the invoice.
            const currentCreated = doc.data().dateCreated;
            let year = "2025";
            if (currentCreated && currentCreated.includes(".")) {
                const parts = currentCreated.split(".");
                if (parts.length === 3) year = parts[2];
            }
            const newDate = `28.02.${year}`;

            await doc.ref.update({ dateCreated: newDate });
            console.log(`Successfully updated dateCreated from ${currentCreated} to ${newDate}`);
        });
    }
}

fixAlexela();
