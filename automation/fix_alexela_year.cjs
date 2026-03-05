const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixAlexelaYear() {
    console.log('Searching for Alexela invoice...');

    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.where('invoiceId', '==', '206181001-26021').get();

    if (snapshot.empty) {
        console.log("Invoice 206181001-26021 not found.");
    } else {
        snapshot.forEach(async (doc) => {
            const currentCreated = doc.data().dateCreated;
            // The previous script accidentally set it to 28.02.2025. We need it to be 28-02-2026 or 28.02.2026.
            // Looking at the standard format the system uses, let's use DD-MM-YYYY or DD.MM.YYYY. 
            // The AI parsed 17-02-2026 initially.
            const newDate = `28-02-2026`;

            await doc.ref.update({ dateCreated: newDate });
            console.log(`Successfully updated dateCreated from ${currentCreated} to ${newDate}`);
        });
    }
}

fixAlexelaYear();
