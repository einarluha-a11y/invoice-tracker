const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
    console.log("Injecting a test Invoice Intelligence Payload...");
    try {
        const companyId = "bP6dc0PMdFtnmS5QTX4N"; // Global Technics
        
        await db.collection('invoices').add({
            invoiceId: "IDP-TEST-999",
            vendorName: "Google Cloud EMEA",
            amount: 120.00,
            subtotalAmount: 100.00,
            taxAmount: 20.00,
            currency: "EUR",
            dateCreated: "2026-03-24",
            dueDate: "2026-04-24",
            status: "Needs Action",
            companyId: companyId,
            fileUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
            validationWarnings: [
                "Mathematics mismatch: Subtotal (100) + Tax (20) != Total (120)? Wait it does. Test warning!",
                "Confidence score for vendor is slightly low (0.75)"
            ],
            lineItems: [
                { description: "Document AI API Calls - Tier 1", amount: 45.00 },
                { description: "Compute Engine - e2-micro", amount: 35.00 },
                { description: "Cloud Storage Bucket Read/Write", amount: 20.00 }
            ],
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("Test Invoice injected successfully!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
run();
