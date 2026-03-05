const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function checkKonicaDates() {
    console.log('Querying for Konica Minolta invoice dates...');

    const snapshot = await db.collection('invoices').get();

    let docs = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.vendorName && data.vendorName.toLowerCase().includes('konica') && data.amount === 24.81) {
            docs.push(data);
        }
    });

    const parseDateFallback = (d) => {
        if (!d) return 0;
        const match = d.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
        if (match) {
            let [_, day, month, yr] = match;
            if (yr.length === 2) yr = '20' + yr;
            return new Date(`${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).getTime();
        }
        return new Date(d).getTime() || 0;
    };

    docs.forEach(data => {
        const parsedMs = parseDateFallback(data.dateCreated);
        const parsedDate = new Date(parsedMs).toISOString();
        console.log(`Invoice: ${data.invoiceId} | Raw Date: ${data.dateCreated} | Parsed: ${parsedDate}`);
    });

    process.exit(0);
}

checkKonicaDates();
