const admin = require('firebase-admin');
var serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkDupes() {
    console.log('[System] Scanning Ideacom (vlhvA6i8d3Hry8rtrA3Z) for duplicate signatures...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    const grouped = {};
    let totalInvoices = 0;

    snapshot.forEach(doc => {
        totalInvoices++;
        const data = doc.data();
        let vendor = (data.vendorName || data.vendor || 'Unknown').toLowerCase().trim();
        let amount = Number(data.amount) || 0;
        let key = `${vendor}_${amount}`;

        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push({
            id: doc.id,
            invoiceId: data.invoiceId,
            date: data.dateCreated,
            status: data.status,
            subtotal: data.subtotalAmount,
            tax: data.taxAmount
        });
    });

    console.log(`\nFound ${totalInvoices} total invoices in Ideacom.`);
    let duplicatesFound = 0;

    for (const [key, records] of Object.entries(grouped)) {
        if (records.length > 1) {
            duplicatesFound++;
            console.log(`\n⚠️ Suspicious Pair Found [${key}]:`);
            records.forEach(r => {
                console.log(`  -> ID: ${r.id} | Inv: '${r.invoiceId}' | Date: '${r.date}' | Subtotal: ${r.subtotal} | Tax: ${r.tax} | Status: ${r.status}`);
            });
        }
    }

    if (duplicatesFound === 0) {
        console.log(`\n✅ DATABASE IS PRISTINE. Zero duplicates found in Ideacom!`);
    } else {
        console.log(`\n🚨 Found ${duplicatesFound} potential duplicate pairs.`);
    }

    process.exit(0);
}

checkDupes();
