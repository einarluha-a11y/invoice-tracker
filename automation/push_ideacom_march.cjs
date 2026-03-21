const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function resyncIdeacomInvoices() {
    console.log("Fetching Ideacom invoices since March 1st...");
    const ideacomCompanyId = "vlhvA6i8d3Hry8rtrA3Z";

    try {
        const compDoc = await db.collection('companies').doc(ideacomCompanyId).get();
        const webhookUrl = compDoc.data().zapierWebhookUrl;

        if (!webhookUrl) {
            console.error("Webhook URL not found!");
            process.exit(1);
        }

        const snapshot = await db.collection('invoices')
            .where('companyId', '==', ideacomCompanyId)
            .get();

        if (snapshot.empty) {
            console.log("No invoices found for Ideacom.");
            process.exit(0);
        }

        const validInvoices = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.dateCreated) {
                const parts = data.dateCreated.includes('-') ? data.dateCreated.split('-') : data.dateCreated.split('.');
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[2] || "2026", 10);

                if (year >= 2026 && month >= 3) {
                    validInvoices.push({ id: doc.id, ...data });
                }
            } else if (data.createdAt) {
                const dateObj = data.createdAt.toDate();
                if (dateObj.getFullYear() >= 2026 && dateObj.getMonth() >= 2) {
                    validInvoices.push({ id: doc.id, ...data });
                }
            }
        });

        console.log(`Found ${validInvoices.length} Ideacom invoices from March onwards.`);

        for (const [index, invoice] of validInvoices.entries()) {
            if (!invoice.fileUrl) {
                console.log(`   -> Skipping ${invoice.vendorName} [${invoice.id}] because it has no PDF file attached.`);
                continue;
            }

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
                companyName: "Ideacom OÜ" 
            };

            if (payload.dateCreated && (payload.dateCreated.includes("-") || payload.dateCreated.includes("."))) {
                const parts = payload.dateCreated.includes("-") ? payload.dateCreated.split("-") : payload.dateCreated.split(".");
                payload.invoiceMonth = parseInt(parts[1], 10).toString();
                payload.invoiceYear = parts[2] || new Date().getFullYear().toString();
            } else {
                const now = new Date();
                payload.invoiceMonth = (now.getMonth() + 1).toString();
                payload.invoiceYear = now.getFullYear().toString();
            }

            const folderPrefix = "IC";
            const folderBasePath = "IDEACOM";

            // e.g. IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3
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

            await new Promise(r => setTimeout(r, 1500));
        }

        console.log("Resync complete!");
        process.exit(0);
    } catch (e) {
        console.error("Fatal Error:", e);
        process.exit(1);
    }
}

resyncIdeacomInvoices();
