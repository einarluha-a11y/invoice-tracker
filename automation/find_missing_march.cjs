const admin = require('firebase-admin');

try {
    const serviceAccount = require('./google-credentials.json');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
}
const db = admin.firestore();

async function findMissingMarchFiles() {
    console.log("Querying all invoices to find March 2026 missing files based on dateCreated...");
    const snapshot = await db.collection('invoices').get();

    let missingMarchDocs = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        let dc = data.dateCreated || '';
        
        // Match string formats like DD-03-2026, DD.03.2026
        if ((dc.includes('-03-2026') || dc.includes('.03.2026') || dc.includes('-03-202') || dc.includes('03-2026')) || 
            (data.invoiceMonth === '3' && data.invoiceYear === '2026')) {
            
            if (!data.fileUrl || data.fileUrl === null || data.fileUrl === '') {
                missingMarchDocs.push({
                    id: doc.id,
                    vendor: data.vendorName,
                    invId: data.invoiceId,
                    date: dc,
                    companyId: data.companyId,
                    amount: data.amount
                });
            }
        }
    });

    console.log(`\nFound ${missingMarchDocs.length} missing files for March 2026.`);
    console.log(JSON.stringify(missingMarchDocs, null, 2));

    process.exit(0);
}

findMissingMarchFiles().catch(console.error);
