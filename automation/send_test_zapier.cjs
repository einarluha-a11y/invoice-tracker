const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const payload = {
        invoiceId: "TEST-GT-999",
        vendorName: "Zapier Test Vendor",
        amount: 150.00,
        currency: "EUR",
        dateCreated: "07-03-2026",
        dueDate: "07-03-2026",
        invoiceYear: "2026",
        invoiceMonth: "3",
        status: "Unpaid",
        fileUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", // Valid dummy PDF URL
        companyId: "dummyId123",
        companyName: "Global Technics OÜ",
        dropboxFolderPath: "/GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_2026/GT_arved_meile_2026_3"
    };

    console.log("Sending test payload with dropboxFolderPath to Zapier:");
    console.log(JSON.stringify(payload, null, 2));

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
}

run();
