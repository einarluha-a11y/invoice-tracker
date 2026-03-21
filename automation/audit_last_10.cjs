const admin = require('firebase-admin');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');
var serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function runAudit() {
    console.log('[Audit] Fetching the latest invoices and filtering for Ideacom...');
    const snapshot = await db.collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

    const ideacomDocs = snapshot.docs.filter(doc => doc.data().companyId === 'vlhvA6i8d3Hry8rtrA3Z').slice(0, 10);
    
    let passedCount = 0;
    let failedCount = 0;

    for (const doc of ideacomDocs) {
        const data = doc.data();
        console.log(`\n==================================================`);
        console.log(`🧾 TARGET: ${data.vendorName} | Invoice: ${data.invoiceId}`);
        console.log(`==================================================`);

        // 1. File Presence Check
        let fileStatus = '❌ MISSING';
        let filePass = false;
        if (data.fileUrl && data.fileUrl.startsWith('https://')) {
            fileStatus = '✅ PRESENT';
            filePass = true;
        }
        console.log(`[Check 1] Physical Binary URL: ${fileStatus}`);

        // 2. Supervisor Gate Check
        // Simulate missing strings if they fall back to empty string from AI cleaning
        const supervisorData = { ...data };
        if (supervisorData.supplierRegistration === "") supervisorData.supplierRegistration = "NOT_FOUND_ON_INVOICE";
        if (supervisorData.supplierVat === "") supervisorData.supplierVat = "NOT_FOUND_ON_INVOICE";

        console.log(`[Check 2] Routing payload through Supreme Supervisor...`);
        const supervisorResult = await intellectualSupervisorGate(supervisorData);

        // 3. Mathematical Integrity Check (Sub + Tax = Total)
        let mathStatus = '❌ FAILED';
        let mathPass = false;
        const total = Number(data.amount) || 0;
        const sub = Number(data.subtotalAmount) || 0;
        const tax = Number(data.taxAmount) || 0;
        
        // Use a small epsilon for floating point math
        if (Math.abs(sub + tax - total) <= 0.05) {
            mathStatus = `✅ VALID (${sub} + ${tax} = ${total})`;
            mathPass = true;
        } else {
            mathStatus = `❌ MISMATCH (Sub: ${sub} + Tax: ${tax} != Total: ${total})`;
        }
        console.log(`[Check 3] Mathematical Integrity: ${mathStatus}`);

        const fullyCompliant = filePass && supervisorResult.passed && mathPass;

        if (fullyCompliant) {
            console.log(`\n🏆 FINAL VERDICT: PERFECTLY COMPLIANT.`);
            passedCount++;
        } else {
            console.log(`\n🚨 FINAL VERDICT: COMPLIANCE FAILURE.`);
            failedCount++;
        }
    }

    console.log(`\n\n--------------------------------------------------`);
    console.log(`📋 AUDIT SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED.`);
    console.log(`--------------------------------------------------`);
    process.exit(0);
}

runAudit();
