const { db } = require('./automation/core/firebase.cjs');
(async () => {
    const snap = await db.collection('invoices').orderBy('createdAt', 'desc').limit(15).get();
    console.log('--- LATEST 15 INVOICES IN CLOUD FIRESTORE ---');
    snap.docs.forEach(doc => {
        const d = doc.data();
        const dateStr = d.createdAt ? d.createdAt.toDate().toISOString() : 'Unknown';
        console.log(`ID: ${doc.id.padEnd(20)} | Vendor: ${(d.vendorName||'').padEnd(30)} | InvID: ${(d.invoiceId||'').padEnd(25)} | Amt: ${d.amount} | File: ${d.fileUrl?.slice(0,15)}... | CreatedAt: ${dateStr}`);
    });
    process.exit(0);
})();
