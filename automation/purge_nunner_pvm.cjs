const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function purgeNunnerBadInvoice() {
    try {
        const snapshot = await db.collection('invoices').get();
        let deleted = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const idLower = (data.invoiceId || '').toLowerCase();
            const vendorLower = (data.vendorName || '').toLowerCase();

            if (vendorLower.includes('nunner') && idLower.includes('pvm')) {
                console.log(`[DELETING BAD DOC] ID: "${data.invoiceId}" | Vendor: "${data.vendorName}"`);
                await doc.ref.delete();
                deleted++;
            }
        }

        console.log(`Successfully purged ${deleted} bad NUNNER invoices.`);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

purgeNunnerBadInvoice();
