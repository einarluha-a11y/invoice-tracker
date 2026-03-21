const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function resyncGTInvoices() {
    console.log("Fetching Global Technics invoices since March 1st...");
    const gtCompanyId = "bP6dc0PMdFtnmS5QTX4N";
    const ideacomCompanyId = "vlhvA6i8d3Hry8rtrA3Z"; // Using Ideacom to get the Webhook URL since GT shares it

    try {
        // 1. Get Webhook URL from Ideacom (as instructed previously)
        const compDoc = await db.collection('companies').doc(ideacomCompanyId).get();
        const webhookUrl = compDoc.data().zapierWebhookUrl;

        if (!webhookUrl) {
            console.error("Webhook URL not found!");
            process.exit(1);
        }

        // 2. Query all GT invoices from firestore
        // Since dateCreated is a string like "10-03-2026", we can just fetch all GT invoices
        // and filter in memory for those that match March 2026.
        const snapshot = await db.collection('invoices')
            .where('companyId', '==', gtCompanyId)
            .get();

        if (snapshot.empty) {
            console.log("No invoices found for Global Technics.");
            process.exit(0);
        }

        const validInvoices = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Expected formats: "DD-MM-YYYY" or "DD.MM.YYYY"
            if (data.dateCreated) {
                const parts = data.dateCreated.includes('-') ? data.dateCreated.split('-') : data.dateCreated.split('.');
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[2] || "2026", 10);

                // March 2026 onwards
                if (year >= 2026 && month >= 3) {
                    validInvoices.push({ id: doc.id, ...data });
                }
            } else if (data.createdAt) {
                // Fallback to insertion timestamp
                const dateObj = data.createdAt.toDate();
                if (dateObj.getFullYear() >= 2026 && dateObj.getMonth() >= 2) { // 2 = March in JS
                    validInvoices.push({ id: doc.id, ...data });
                }
            }
        });

        console.log(`Found ${validInvoices.length} Global Technics invoices from March onwards.`);

        // 3. Resend to Zapier
        for (const [index, invoice] of validInvoices.entries()) {
            // Skip Zapier if file is missing because Dropbox Upload requires it
            if (!invoice.fileUrl) {
                console.log(`   -> Skipping ${invoice.vendorName} because it still has no PDF file attached.`);
                continue;
            }

            // Build the exact payload that index.js sends
            const payload = {
                invoiceId: invoice.invoiceId,
                vendorName: invoice.vendorName,
                amount: invoice.amount,
                currency: invoice.currency || 'EUR',
                dateCreated: invoice.dateCreated || '',
                dueDate: invoice.dueDate || '',
                status: invoice.status || 'Unpaid',
                fileUrl: invoice.fileUrl || null,
                companyId: invoice.companyId,
                companyName: "Global Technics OÜ" 
            };

            // Calculate path variables
            if (payload.dateCreated && (payload.dateCreated.includes("-") || payload.dateCreated.includes("."))) {
                const parts = payload.dateCreated.includes("-") ? payload.dateCreated.split("-") : payload.dateCreated.split(".");
                payload.invoiceMonth = parseInt(parts[1], 10).toString();
                payload.invoiceYear = parts[2] || new Date().getFullYear().toString();
            } else {
                const now = new Date();
                payload.invoiceMonth = (now.getMonth() + 1).toString();
                payload.invoiceYear = now.getFullYear().toString();
            }

            const folderPrefix = "GT";
            const folderBasePath = "GLOBAL TECHNICS";

            // e.g. GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_2026/GT_arved_meile_2026_3
            payload.dropboxFolderPath = `${folderBasePath}/${folderPrefix}_ARVED/${folderPrefix}_arved_meile/${folderPrefix}_arved_meile_${payload.invoiceYear}/${folderPrefix}_arved_meile_${payload.invoiceYear}_${payload.invoiceMonth}`;

            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    console.log(`   -> Successfully pushed to Zapier (${payload.vendorName})`);
                } else {
                    console.error(`   -> Failed to push: ${response.status} ${response.statusText}`);
                }
            } catch (err) {
                console.error(`   -> Network Error:`, err.message);
            }

            // Wait 1.5 seconds between requests to avoid rate limits
            await new Promise(r => setTimeout(r, 1500));
        }

        console.log("Resync complete!");
        process.exit(0);
    } catch (e) {
        console.error("Fatal Error:", e);
        process.exit(1);
    }
}

resyncGTInvoices();
