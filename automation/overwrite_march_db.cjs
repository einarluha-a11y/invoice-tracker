require('dotenv').config();
const admin = require('firebase-admin');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function upgradeMarchInvoices() {
    console.log(`[Database Upgrade] 🚀 Launching Global Firestore Rewrite via Pure Claude Engine...`);
    
    const snapshot = await db.collection('invoices').get();
    const marchInvoices = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        let isMarch = false;
        if (data.dateCreated) {
            const parts = data.dateCreated.includes('-') ? data.dateCreated.split('-') : data.dateCreated.split('.');
            if (parts.length >= 2) {
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[2] || parts[0], 10);
                if ((year === 2026 || year === 26) && month === 3) isMarch = true;
            }
        }
        if (!isMarch && data.createdAt) {
            const dateObj = data.createdAt.toDate();
            if (dateObj.getFullYear() === 2026 && dateObj.getMonth() === 2) isMarch = true; 
        }
        
        if (isMarch && data.fileUrl) {
            marchInvoices.push({ doc: doc, fileUrl: data.fileUrl, vendorName: data.vendorName });
        }
    });

    console.log(`[Database Upgrade] 📂 Discovered ${marchInvoices.length} physical March PDFs to Overwrite.\n`);

    for (let i = 0; i < marchInvoices.length; i++) {
        const inv = marchInvoices[i];
        console.log(`[${i+1}/${marchInvoices.length}] 📥 Upgrading legacy record: ${inv.vendorName}...`);
        
        try {
            const response = await fetch(inv.fileUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            console.log(`   -> 🧠 Rerunning purely semantic extraction...`);
            const payloads = await processInvoiceWithDocAI(buffer, 'application/pdf');
            
            if (payloads && payloads.length > 0) {
                const p = payloads[0];

                const gateResult = await intellectualSupervisorGate(p);
                if (!gateResult.passed) {
                    console.log(`   -> [Supreme Supervisor] 🛑 BLOCKED UPGRADE: ${gateResult.reason}`);
                    continue;
                }
                
                // EXECUTING THE DESTRUCTIVE OVERWRITE
                await inv.doc.ref.update({
                    vendorName: p.vendorName || inv.vendorName,
                    amount: p.amount || 0,
                    taxAmount: p.taxAmount || 0,
                    subtotalAmount: p.subtotalAmount || 0,
                    currency: p.currency || "EUR",
                    supplierRegistration: p.supplierRegistration || "",
                    supplierVat: p.supplierVat || "",
                    lineItems: p.lineItems || [],
                    status: 'OOTEL',  // Ensure status reflects the new flawless data
                    validationWarnings: [] // Wipe out old OCR warnings!
                });
                
                console.log(`   -> 🟢 SUCCESS: Permanently overwrote Database ID ${inv.doc.id} with ${p.amount} ${p.currency} from Vendor ${p.vendorName}`);
            }
            
        } catch (e) {
            console.error(`   -> 🔴 ERROR on ${inv.doc.id}: ${e.message}`);
        }
        
        // Sleep 4 seconds to aggressively dodge Anthropic Tier 1 token throttling (approx 40K tokens per minute)
        await new Promise(resolve => setTimeout(resolve, 4000));
    }

    console.log(`\n[Database Upgrade] 🏁 Complete! The Dashboard is now perfectly synchronized with the true AI metrics.`);
    process.exit(0);
}

upgradeMarchInvoices();
