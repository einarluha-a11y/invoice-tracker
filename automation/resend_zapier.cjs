const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const docRef = db.collection('invoices').doc('blbqZaoI334lxGMYtu8c');
    const doc = await docRef.get();

    if (doc.exists) {
        const data = doc.data();
        const payload = {
            invoiceId: data.invoiceId,
            vendorName: data.vendorName,
            amount: data.amount,
            currency: data.currency || 'EUR',
            dateCreated: data.dateCreated || '',
            invoiceYear: data.dateCreated ? data.dateCreated.split("-")[2] || data.dateCreated.split(".")[2] : new Date().getFullYear().toString(),
            invoiceMonth: data.dateCreated ? parseInt(data.dateCreated.split("-")[1] || data.dateCreated.split(".")[1] || "1", 10).toString() : (new Date().getMonth() + 1).toString(),
            dueDate: data.dueDate || '',
            status: data.status,
            fileUrl: data.fileUrl || null,
            companyId: data.companyId,
            companyName: 'Ideacom OÜ' // Add company name as the production code does
        };

        console.log("Sending payload to Zapier:", payload);

        const response = await fetch("https://hooks.zapier.com/hooks/catch/26719164/uxu5kvy/", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`Webhook delivered successfully`);
        } else {
            console.error(`Zapier responded with ${response.status} ${response.statusText}`);
        }
    } else {
        console.log("Invoice not found.");
    }
}

run();
