require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');

async function diagnose() {
    console.log("🔍 Diagnosing Firestore invoice statuses...\n");

    const snap = await db.collection('invoices').get();
    
    const statusCounts = {};
    const fileUrlStats = { hasFileUrl: 0, hasOriginalFileUrl: 0, hasBoth: 0, hasNeither: 0 };
    const companyStats = {};
    
    snap.forEach(doc => {
        const data = doc.data();
        const status = data.status || '(empty)';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        
        const hasFileUrl = !!data.fileUrl;
        const hasOriginalFileUrl = !!data.originalFileUrl;
        if (hasFileUrl && hasOriginalFileUrl) fileUrlStats.hasBoth++;
        else if (hasFileUrl) fileUrlStats.hasFileUrl++;
        else if (hasOriginalFileUrl) fileUrlStats.hasOriginalFileUrl++;
        else fileUrlStats.hasNeither++;
        
        const cid = data.companyId || '(no companyId)';
        if (!companyStats[cid]) companyStats[cid] = { total: 0, statuses: {} };
        companyStats[cid].total++;
        companyStats[cid].statuses[status] = (companyStats[cid].statuses[status] || 0) + 1;
    });
    
    console.log("=== STATUS COUNTS (all companies) ===");
    Object.entries(statusCounts).sort((a,b) => b[1]-a[1]).forEach(([s, n]) => {
        console.log(`  "${s}": ${n}`);
    });
    
    console.log("\n=== FILE URL FIELDS ===");
    console.log(`  hasFileUrl only: ${fileUrlStats.hasFileUrl}`);
    console.log(`  hasOriginalFileUrl only: ${fileUrlStats.hasOriginalFileUrl}`);
    console.log(`  hasBoth: ${fileUrlStats.hasBoth}`);
    console.log(`  hasNeither: ${fileUrlStats.hasNeither}`);
    
    console.log("\n=== PER COMPANY STATUS BREAKDOWN ===");
    Object.entries(companyStats).forEach(([cid, stats]) => {
        console.log(`\n  Company: ${cid} (${stats.total} total)`);
        Object.entries(stats.statuses).forEach(([s, n]) => {
            console.log(`    "${s}": ${n}`);
        });
    });
    
    process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
