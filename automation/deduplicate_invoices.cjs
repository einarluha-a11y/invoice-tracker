const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function deduplicateInvoices() {
    console.log('[DB] Scanning for duplicate invoices...');
    const snapshot = await db.collection('invoices').get();
    
    // Map of "VendorName_InvoiceID_CompanyId" to an array of document snapshots
    const invoiceMap = new Map();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const vendor = (data.vendorName || '').trim().toLowerCase();
        const invId = String(data.invoiceId || '').trim().toLowerCase();
        const companyId = data.companyId || 'UNKNOWN';
        
        // Skip ones that have Auto-generated timestamp IDs since we can't be sure they are dupes
        if (invId.startsWith('auto-')) return;
        
        const key = `${vendor}_${invId}_${companyId}`;
        
        if (!invoiceMap.has(key)) {
            invoiceMap.set(key, []);
        }
        invoiceMap.get(key).push(doc);
    });

    let deletedCount = 0;

    for (const [key, docs] of invoiceMap.entries()) {
        if (docs.length > 1) {
            console.log(`[DB] Found ${docs.length} duplicates for ${key}`);
            
            // Sort by createdAt descending (newest first). Keep the first, delete the rest.
            docs.sort((a, b) => {
                const timeA = a.data().createdAt ? a.data().createdAt.toMillis() : 0;
                const timeB = b.data().createdAt ? b.data().createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            // Delete everything except docs[0]
            for (let i = 1; i < docs.length; i++) {
                console.log(`     - Deleting duplicate document ID: ${docs[i].id}`);
                await docs[i].ref.delete();
                deletedCount++;
            }
        }
    }

    console.log(`[DB] Deduplication complete! Deleted ${deletedCount} duplicate records.`);
}

deduplicateInvoices().then(() => process.exit(0)).catch(console.error);
