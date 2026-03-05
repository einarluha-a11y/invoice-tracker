const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function debugReconcile(reference, description, paidAmount) {
    try {
        const invoicesRef = db.collection('invoices');
        let matchedDoc = null;

        const normalizeString = (str) => String(str || '').toLowerCase().trim();

        const snapshot = await invoicesRef.where('status', '!=', 'Paid').get();
        const pendingDocs = [];
        snapshot.forEach(doc => pendingDocs.push(doc));

        const bankRef = normalizeString(reference);
        const bankDesc = normalizeString(description);

        console.log(`Bank Ref: "${bankRef}", Bank Desc: "${bankDesc}", Amount: ${paidAmount}`);

        // 1. Match by Reference
        if (bankRef) {
            for (const doc of pendingDocs) {
                const data = doc.data();
                const dbId = normalizeString(data.invoiceId);
                if (dbId) {
                    if (dbId === bankRef ||
                        (dbId.length >= 4 && bankRef.includes(dbId)) ||
                        (bankRef.length >= 4 && dbId.includes(bankRef))) {
                        matchedDoc = doc;
                        console.log(`-> MATCHED BY REF: ${data.invoiceId}`);
                        break;
                    }
                }
            }
        }

        // 2. Vendor Name
        if (!matchedDoc && description) {
            for (const doc of pendingDocs) {
                const data = doc.data();
                const amountDiff = Math.abs((data.amount || 0) - paidAmount);

                const vendorWords = (data.vendorName || '')
                    .toLowerCase()
                    .split(/[^a-z0-9]/)
                    .filter(w => w.length >= 3);

                const isNameMatch = vendorWords.some(word => bankDesc.includes(word));
                if (data.vendorName.toLowerCase().includes('deepl')) {
                    console.log(`  Comparing with Vendor: ${data.vendorName} | Words: ${vendorWords.join(',')} | Includes? ${isNameMatch} | DB Amount: ${data.amount} | Diff: ${amountDiff}`);
                }

                if (isNameMatch && amountDiff <= 0.05) {
                    matchedDoc = doc;
                    console.log(`-> MATCHED BY VENDOR: ${data.vendorName} (${data.invoiceId})`);
                    break;
                }
            }
        }

        if (matchedDoc) {
            console.log(`SUCCESS: Matched invoice ${matchedDoc.data().invoiceId}`);
        } else {
            console.log(`FAILURE: No match found.`);
        }
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

// Simulate what the PDF AI or CSV parser likely outputs for DeepL
debugReconcile("", "DeepL SE", 29.99);
