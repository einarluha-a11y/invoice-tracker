require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function auditMarchInvoices() {
    console.log(`[Batch Audit] 🚀 Launching Pure Claude Engine across all March Invoices...`);
    
    // Fetch all March invoices (filtering by dateCreated or createdAt)
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
            if (dateObj.getFullYear() === 2026 && dateObj.getMonth() === 2) isMarch = true; // 0-indexed month
        }
        
        if (isMarch && data.fileUrl) {
            marchInvoices.push({ id: doc.id, fileUrl: data.fileUrl, originalVendor: data.vendorName });
        }
    });

    console.log(`[Batch Audit] 📂 Discovered ${marchInvoices.length} physical March PDFs to re-process.\n`);

    const markdownRows = [];
    markdownRows.push(`| Status | Vendor | Subtotal | Tax (VAT) | Total | Supplier Reg. No. | VAT Reg. No. |`);
    markdownRows.push(`|---|---|---|---|---|---|---|`);

    for (let i = 0; i < marchInvoices.length; i++) {
        const inv = marchInvoices[i];
        console.log(`[${i+1}/${marchInvoices.length}] 📥 Downloading PDF for legacy record: ${inv.originalVendor}...`);
        
        try {
            const response = await fetch(inv.fileUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            console.log(`[${i+1}/${marchInvoices.length}] 🧠 Running Pure Claude Cognitive Extraction...`);
            const payloads = await processInvoiceWithDocAI(buffer, 'application/pdf');
            
            if (payloads && payloads.length > 0) {
                const p = payloads[0];
                const cleanVendor = (p.vendorName || 'N/A').replace(/\\|/g, '');
                
                markdownRows.push(`| ✅ | **${cleanVendor}** | ${p.subtotalAmount || 0} ${p.currency} | ${p.taxAmount || 0} ${p.currency} | **${p.amount || 0} ${p.currency}** | \`${p.supplierRegistration || 'N/A'}\` | \`${p.supplierVat || 'N/A'}\` |`);
                console.log(`   -> 🟢 SUCCESS: Extracted ${p.amount} ${p.currency} for ${cleanVendor}`);
            }
            
        } catch (e) {
            console.error(`   -> 🔴 ERROR on ${inv.id}: ${e.message}`);
            markdownRows.push(`| ❌ | ${inv.originalVendor} (Legacy) | ERROR | ERROR | ERROR | ERROR | ERROR |`);
        }
        
        // Save incremental progress
        fs.writeFileSync('march_audit_report.md', markdownRows.join('\\n'));
        
        // Sleep 2 seconds to respect Claude API rate limits (Tier 2/3)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\n[Batch Audit] 🏁 Complete! Wrote results to march_audit_report.md`);
    process.exit(0);
}

auditMarchInvoices();
