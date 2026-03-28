require('dotenv').config({ path: '../.env' });
const { db } = require('./core/firebase.cjs');

// Usage: node diagnose_company_files.cjs [companyId]
// Example: node diagnose_company_files.cjs global-technics

async function diagnose() {
    const companyId = process.argv[2];
    if (!companyId) {
        console.log("Usage: node diagnose_company_files.cjs <companyId>");
        console.log("Available companies:");
        const comps = await db.collection('companies').get();
        comps.forEach(d => console.log(`  ${d.id}  (${d.data().name || ''})`));
        process.exit(0);
    }

    console.log(`\n🔍 Diagnosing invoices for company: ${companyId}\n`);
    const snap = await db.collection('invoices').where('companyId', '==', companyId).get();
    
    if (snap.empty) {
        console.log("No invoices found for this company.");
        process.exit(0);
    }

    let noFile = 0, hasFile = 0, hasOriginal = 0;
    const needsReviewNoFile = [];

    snap.forEach(doc => {
        const d = doc.data();
        if (d.fileUrl) hasFile++;
        else if (d.originalFileUrl) hasOriginal++;
        else {
            noFile++;
            if (d.status === 'NEEDS_REVIEW' || d.status === 'Needs Action') {
                needsReviewNoFile.push({ id: doc.id, vendor: d.vendorName, status: d.status });
            }
        }
    });

    console.log(`Total invoices: ${snap.size}`);
    console.log(`  hasFileUrl:         ${hasFile}`);
    console.log(`  hasOriginalFileUrl: ${hasOriginal}`);
    console.log(`  has NO file URL:    ${noFile}`);
    
    if (needsReviewNoFile.length > 0) {
        console.log(`\n⚠️  KARANTIIN records with no file URL (${needsReviewNoFile.length}):`);
        needsReviewNoFile.forEach(r => console.log(`  ${r.id}  ${r.vendor}  [${r.status}]`));
    }
    process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
