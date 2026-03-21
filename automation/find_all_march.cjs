const admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function findAllMarch() {
    console.log('[Audit] Fetching ALL Ideacom invoices to find the 15 March records...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    let marchInvoices = [];

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const dateStr = data.dateCreated || '';
        
        // Match anything that looks like March 2026:
        // DD-MM-YYYY (e.g. 05-03-2026)
        // YYYY-MM-DD (e.g. 2026-03-05)
        // D.M.YYYY (e.g. 5.03.2026 or 5.3.2026)
        const isMarch2026 = 
            dateStr.includes('-03-2026') || 
            dateStr.includes('.03.2026') || 
            dateStr.includes('/03/2026') || 
            dateStr.startsWith('2026-03') ||
            dateStr.startsWith('26-03') ||
            (dateStr.match(/\b3[\.\-\/]?2026/) !== null) ||
            (dateStr.match(/\b03[\.\-\/]?2026/) !== null);

        if (isMarch2026) {
            marchInvoices.push({ id: doc.id, ...data });
        }
    }

    marchInvoices.sort((a, b) => {
        const dateA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
        const dateB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
        return dateB - dateA;
    });

    console.log(`\nFound ${marchInvoices.length} March invoices:`);
    marchInvoices.forEach((inv, i) => {
        const fileUrlStatus = inv.fileUrl ? '✅ FILE' : '❌ NO FILE';
        const mathCheck = (Number(inv.subtotalAmount) || 0) + (Number(inv.taxAmount) || 0) === (Number(inv.amount) || 0) ? '✅ MATH' : '❌ BAD MATH';
        console.log(`${i+1}. [${inv.dateCreated}] ${inv.vendorName} | Inv: ${inv.invoiceId} | ${fileUrlStatus} | ${mathCheck}`);
    });
    
    process.exit(0);
}

findAllMarch();
