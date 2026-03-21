const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixCompanyId() {
    const targetDocId = 'BNXEu1tb2dEQA3RdL9Sw';
    const ideacomCompanyId = 'vlhvA6i8d3Hry8rtrA3Z'; 

    console.log(`Moving invoice ${targetDocId} to Ideacom (${ideacomCompanyId})...`);
    
    await db.collection('invoices').doc(targetDocId).update({
        companyId: ideacomCompanyId
    });

    console.log("Successfully moved!");
    process.exit();
}

fixCompanyId();
