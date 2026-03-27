const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = admin.firestore();

async function run() {
    console.log("[Cleanup] Searching for temporary Safety Net drafts to remove...");
    const snap = await db.collection('invoices').get();
    let deleted = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        if ((!data.amount || data.amount === 0 || data.amount === '0.00' || data.amount === '0') && 
            (data.status === 'OOTEL' || data.status === 'NEEDS_REVIEW')) {
            // Further verify it's a draft
            if (data.vendorName === 'UNKNOWN VENDOR' || String(data.vendorName).toLowerCase().includes('.pdf') || !data.fileUrl) {
                console.log(`[Cleanup] Destroying obsolete draft ID: ${doc.id} (Vendor: ${data.vendorName})`);
                await doc.ref.delete();
                deleted++;
            }
        }
    }
    console.log(`[Cleanup] Successfully removed ${deleted} obsolete drafts. Workspace is clean.`);
    process.exit(0);
}

run();
