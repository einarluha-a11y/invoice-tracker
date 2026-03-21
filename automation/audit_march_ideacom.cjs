const admin = require('firebase-admin');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');
var serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function runAudit() {
    console.log('[March Audit] Fetching all Ideacom invoices and filtering strictly by March 2026 issue dates...');
    const snapshot = await db.collection('invoices')
        .where('companyId', '==', 'vlhvA6i8d3Hry8rtrA3Z')
        .get();

    let passedCount = 0;
    let failedCount = 0;
    let marchInvoices = [];

    // Filter strictly for March 2026 (03-2026)
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.dateCreated && data.dateCreated.includes('-03-2026')) {
            marchInvoices.push(data);
        }
    }

    // Sort descending by creation date (optional, just to show newest first)
    marchInvoices.sort((a, b) => {
        const dateA = a.createdAt ? a.createdAt.toDate().getTime() : 0;
        const dateB = b.createdAt ? b.createdAt.toDate().getTime() : 0;
        return dateB - dateA;
    });

    console.log(`[March Audit] Found ${marchInvoices.length} invoices legally issued in March 2026.`);

    for (const data of marchInvoices) {
        console.log(`\n==================================================`);
        console.log(`🧾 TARGET: ${data.vendorName} | Invoice: ${data.invoiceId} | Issued: ${data.dateCreated}`);
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
        const supervisorData = { ...data };
        if (supervisorData.supplierRegistration === "") supervisorData.supplierRegistration = "NOT_FOUND_ON_INVOICE";
        if (supervisorData.supplierVat === "") supervisorData.supplierVat = "NOT_FOUND_ON_INVOICE";

        const supervisorResult = await intellectualSupervisorGate(supervisorData);

        // 3. Mathematical Integrity Check (Sub + Tax = Total)
        let mathStatus = '❌ FAILED';
        let mathPass = false;
        const total = Number(data.amount) || 0;
        const sub = Number(data.subtotalAmount) || 0;
        const tax = Number(data.taxAmount) || 0;
        
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
    console.log(`📋 MARCH 2026 AUDIT SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED.`);
    console.log(`--------------------------------------------------`);
    process.exit(0);
}

runAudit();
