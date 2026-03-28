require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
const fetch = require('node-fetch'); // Standard fetch or let's use the native fetch if Node 18+

async function runMakerCheckerLoop(content, mimeType, companyData, maxAttempts = 5) {
    let parsedData = null;
    let extractionAttempts = 0;
    let critique = null;

    while (!parsedData && extractionAttempts < maxAttempts) {
        extractionAttempts++;
        const tempParsed = await processInvoiceWithDocAI(content, mimeType, critique, companyData.customAiRules);
        if (!tempParsed || tempParsed.length === 0) break;

        const supervisorVerdict = await intellectualSupervisorGate(tempParsed[0]);

        if (!supervisorVerdict.passed && supervisorVerdict.needsReExtraction) {
            console.log(`[Rerun Supervisor] MISSING DATA! Rerunning extraction: ${supervisorVerdict.critique}`);
            critique = supervisorVerdict.critique;

            if (extractionAttempts >= maxAttempts) {
                console.log(`[Rerun Supervisor] ⚠️ Max reflection attempts reached.`);
                tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
                tempParsed[0].validationWarnings.push(`SUPERVISOR: Forced to accept missing data after deep scan.`);
                tempParsed[0].status = 'NEEDS_REVIEW';
                parsedData = tempParsed;
            }
        } else if (!supervisorVerdict.passed && !supervisorVerdict.needsReExtraction) {
            console.log(`[Rerun Supervisor] 🚨 ANOMALY STRIKE: ${supervisorVerdict.reason}`);
            tempParsed[0].status = 'NEEDS_REVIEW';
            tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
            tempParsed[0].validationWarnings.push(`SUPERVISOR STRIKE: ${supervisorVerdict.reason}`);
            parsedData = tempParsed;
        } else {
            parsedData = tempParsed;
        }
    }
    return parsedData;
}

async function start() {
    console.log("🚀 Starting Quarantine Rewriter Script...");

    try {
        // Find all records that are NEEDS_REVIEW or might have been called KARANTIIN
        // Also includes 'Needs Action' — the status set by accountant_agent.cjs when it quarantines a record
        const snap = await db.collection('invoices')
            .where('status', 'in', ['NEEDS_REVIEW', 'Needs Action', 'KARANTIIN', 'Карантин', 'Karantiin', 'ANOMALY_DETECTED'])
            .get();

        if (snap.empty) {
            console.log("No quarantined records found in database.");
            process.exit(0);
        }

        console.log(`Found ${snap.size} quarantined records. Beginning re-processing...`);

        for (const doc of snap.docs) {
            const data = doc.data();
            console.log(`\n-----------------------------------------`);
            console.log(`Processing Document: ${doc.id} (Vendor: ${data.vendorName}, Status: ${data.status})`);

            if (!data.fileUrl || data.fileUrl === 'BODY_TEXT_NO_ATTACHMENT') {
                console.log(`⏩ Skipping ${doc.id}: No physical PDF file attached to reprocess.`);
                continue;
            }

            console.log(`⏬ Downloading PDF from Firebase Storage: ${data.fileUrl}`);
            let buffer;
            try {
                // If using Node 18+, native fetch is available. Otherwise node-fetch.
                const response = await fetch(data.fileUrl); 
                if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            } catch (err) {
                console.error(`❌ Failed to download PDF for ${doc.id}: ${err.message}`);
                continue;
            }

            // Fetch company rules for overriding
            let companyData = { id: data.companyId, customAiRules: null };
            if (data.companyId) {
                const compDoc = await db.collection('companies').doc(data.companyId).get();
                if (compDoc.exists) {
                    companyData = { id: compDoc.id, ...compDoc.data() };
                }
            }

            console.log(`🧠 Handing PDF (${buffer.length} bytes) to the updated AI Pipeline...`);
            let parsedData = await runMakerCheckerLoop(buffer, 'application/pdf', companyData, 5);

            if (!parsedData || parsedData.length === 0) {
                console.error(`❌ AI completely failed to parse the document.`);
                continue;
            }

            // Clean up warnings from previous runs
            let payload = parsedData[0];
            payload.validationWarnings = [];

            // Audit
            let finalDoc = await auditAndProcessInvoice(payload, data.fileUrl, companyData.id);

            // We explicitly want to clear the old 'NEEDS_REVIEW' legacy
            if (!finalDoc.status || finalDoc.status === 'NEEDS_REVIEW' || finalDoc.status === 'Needs Action') {
                // If it still fails, it keeps the bad status
                 console.log(`⚠️ Document ${doc.id} STILL failed extraction. Status: ${finalDoc.status}`);
            } else {
                 console.log(`✅ Document ${doc.id} successfully recovered! New Status: ${finalDoc.status}`);
            }

            // We must retain the original ID and createdAt time, but overwrite the AI-extracted fields
            const updatePayload = {
                ...finalDoc,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                // DO NOT overwrite createdAt or fileUrl
                createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                fileUrl: data.fileUrl 
            };

            await db.collection('invoices').doc(doc.id).set(updatePayload, { merge: true });
            console.log(`💾 Saved updated record ${doc.id} to Firestore.`);
        }

        console.log(`\n🎉 All Quarantine records have been re-processed successfully!`);
        process.exit(0);

    } catch (e) {
        console.error("FATAL SCRIPT ERROR:", e);
        process.exit(1);
    }
}

start();
