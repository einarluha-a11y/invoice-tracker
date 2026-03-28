const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize Firebase Admin correctly in automation script
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(require('./google-credentials.json')),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    });
}
const db = admin.firestore();

// Import AI Agent logic
const { processPdfWithAi } = require('./document_ai_service.cjs');
const { auditAndProcessInvoice, processNoAttachmentInvoice } = require('./accountant_agent.cjs');

async function runRecovery() {
    console.log("🚀 Starting Quarantine Rewriter Script...");
    
    // FETCH 'Needs Action' since that is what the DB actually stores!
    const snap = await db.collection('invoices')
        .where('status', 'in', ['Needs Action', 'NEEDS_REVIEW', 'KARANTIIN'])
        .get();
        
    if (snap.empty) {
        console.log("No quarantined records found in database.");
        return process.exit(0);
    }
    
    console.log(`Found ${snap.size} records in quarantine/Needs Action. Processing...`);
    
    for (const doc of snap.docs) {
        const data = doc.data();
        console.log(`\n⏳ Processing ID: ${doc.id} | Vendor: ${data.vendorName || 'Unknown'} | Amount: ${data.amount}`);
        
        try {
            // Resolve the best available file URL (support legacy 'originalFileUrl' field)
            const resolvedFileUrl = data.fileUrl || data.originalFileUrl || null;

            if (!resolvedFileUrl || resolvedFileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
               console.log(`  -> Record was created without a PDF file. Will attempt text re-extraction using existing rules.`);
               let docAiPayload = await processNoAttachmentInvoice(data.description || data.invoiceId || '', data.companyId);
               const updatePayload = {
                   ...docAiPayload.docAiPayload,
                   status: docAiPayload.systemStatus,
                   validationWarnings: docAiPayload.warnings,
                   updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                   createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                   fileUrl: null
               };
               await db.collection('invoices').doc(doc.id).set(updatePayload, { merge: true });
               console.log(`  -> ✅ Successfully updated ${doc.id} (Status: ${docAiPayload.systemStatus})`);
               continue;
            }

            console.log(`  -> Downloading file from: ${resolvedFileUrl}`);
            let bucket, destPath;
            if (resolvedFileUrl.startsWith('gs://')) {
                const parts = resolvedFileUrl.replace('gs://', '').split('/');
                bucket = getStorage().bucket(parts[0]);
                const filePath = parts.slice(1).join('/');
                destPath = path.join(os.tmpdir(), `temp_quarantine_${Date.now()}.pdf`);
                await bucket.file(filePath).download({ destination: destPath });
            } else if (resolvedFileUrl.includes('firebasestorage.googleapis.com')) {
                bucket = getStorage().bucket();
                const urlObj = new URL(resolvedFileUrl);
                const fullPath = decodeURIComponent(urlObj.pathname.split('/o/')[1]);
                destPath = path.join(os.tmpdir(), `temp_quarantine_${Date.now()}.pdf`);
                await bucket.file(fullPath).download({ destination: destPath });
            } else {
                console.log(`  -> Unknown fileUrl format, skipping download.`);
                continue;
            }

            console.log(`  -> Running Supreme Supervisor & Document AI...`);
            const aiPayload = await processPdfWithAi(destPath, 'application/pdf');

            console.log(`  -> Running Accountant Rules...`);
            const finalDoc = await auditAndProcessInvoice(aiPayload, resolvedFileUrl, data.companyId);

            const updatePayload = {
                ...finalDoc,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                fileUrl: resolvedFileUrl  // always persist the resolved URL back to canonical 'fileUrl' field
            };
            
            await db.collection('invoices').doc(doc.id).set(updatePayload, { merge: true });
            console.log(`  -> ✅ Successfully updated ${doc.id} (Status: ${finalDoc.status})`);
            
            fs.unlinkSync(destPath);
        } catch(e) {
            console.error(`  -> ❌ Failed to process ${doc.id}: ${e.message}`);
        }
    }
    
    console.log("\n🎉 Quarantine rewriting complete.");
    process.exit(0);
}
runRecovery();
