require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

/**
 * AI Post-Flight Dashboard Auditor
 * Pulls all invoices from Firestore, chunks them, and asks Claude to identify duplicates for deletion.
 */
async function runDashboardAudit() {
    console.log(`[Dashboard Auditor] 🕵️ Starting Post-Flight System Sweep...`);
    
    try {
        const snapshot = await db.collection('invoices').get();
        const allInvoices = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            allInvoices.push({
                dbId: doc.id,
                invoiceId: data.invoiceId || 'N/A',
                vendorName: data.vendorName || data.vendor || 'Unknown',
                amount: data.amount,
                dateCreated: data.dateCreated,
                description: data.description || (data.lineItems && data.lineItems.length > 0 ? data.lineItems[0].description : ''),
                hasFile: !!data.fileUrl
            });
        });

        console.log(`[Dashboard Auditor] 📦 Fetched ${allInvoices.length} invoices from the Dashboard registry.`);

        // Group by vendor for better AI context chunks (so Claude sees the vendor history at once)
        const vendorGroups = {};
        allInvoices.forEach(inv => {
            if (!vendorGroups[inv.vendorName]) vendorGroups[inv.vendorName] = [];
            vendorGroups[inv.vendorName].push(inv);
        });

        const idsToDelete = [];

        // Sweep through each vendor group
        for (const [vendor, invoices] of Object.entries(vendorGroups)) {
            // Only use AI if the vendor has more than 1 invoice (can't have duplicates with 1)
            if (invoices.length > 1) {
                console.log(`\n[Dashboard Auditor] 🧠 Handing over ${vendor} (${invoices.length} records) to Claude 3.5...`);
                
                const prompt = `
You are the Post-Flight Database Auditor AI.
Your job is to clean up a Firestore database of invoices. 
There are historical duplicates in this list because of previous manual bugs.
Look at the following JSON list of invoices for vendor: ${vendor}.

RULES FOR DELETION:
1. Exact Duplicates: If two or more records have the exact same 'invoiceId' AND 'amount' AND 'vendorName'.
2. Near Duplicates: If two records have the exact same 'amount', 'dateCreated', and 'vendorName', they are likely duplicates even if 'invoiceId' is slightly mangled.
3. If you find a duplicate pair, you must keep ONLY ONE. 
4. PREFERENCE RULE: Always keep the record where 'hasFile' is true. If both have files or both lack files, just pick one to keep and delete the rest.
5. Do NOT delete invoices that are just from the same vendor but clearly different transactions (different dates, different amounts).
6. NON-INVOICE PRUNING: This database must ONLY contain financial invoices. If a record has an 'amount' of 0 or null, or if its 'description' / 'invoiceId' strongly suggests it is a CMR (Waybill), an Account Statement (Konto väljavõte), a Quote, or junk text, you MUST flag its 'dbId' for deletion.
7. ⚠️ CRITICAL CREDIT EXEMPTION: Invoices with negative amounts (e.g. -80000) are CREDIT BILLS/LOANS and are HIGHLY VALID. You must NEVER delete negative amount invoices under any circumstances!

Return ONLY a perfectly formatted, valid JSON array of strings containing the 'dbId' of the records that MUST BE DELETED.
Example if id1 and id2 are duplicates of a master: ["id1", "id2"]
If no duplicates are found, return exactly: []
Do not wrap it in markdown blockquotes like \`\`\`json. Just the raw array.

Invoice Registry Data:
${JSON.stringify(invoices, null, 2)}
`;
                
                try {
                    const response = await anthropic.messages.create({
                        model: "claude-sonnet-4-6",
                        max_tokens: 300,
                        temperature: 0,
                        system: "You are an expert database administrator AI. Return ONLY valid JSON arrays.",
                        messages: [{ role: "user", content: prompt }]
                    });

                    // Parse the JSON array
                    let rawAnalysis = response.content[0].text.trim().replace(/^```json\n|\n```$/g, '');
                    let purgeList = [];
                    try {
                        purgeList = JSON.parse(rawAnalysis);
                    } catch(e) {
                         console.error(`[Accountant Agent] ⚠️ Brain returned invalid JSON: ${rawAnalysis}`);
                    }

                    if (Array.isArray(purgeList) && purgeList.length > 0) {
                        console.log(`[Dashboard Auditor] 🚨 Claude flagged ${purgeList.length} duplicates for ${vendor}! IDs:`, purgeList);
                        idsToDelete.push(...purgeList);
                    } else {
                        console.log(`[Dashboard Auditor] ✅ Claude confirms ${vendor} system is clean.`);
                    }

                } catch (apiError) {
                    console.error(`[Dashboard Auditor] LLM Error on ${vendor}:`, apiError.message);
                }
            }
        }

        // Execution: Physical Deletion
        if (idsToDelete.length > 0) {
            console.log(`\n[Dashboard Auditor] 🛑 EXECUTION: Purging ${idsToDelete.length} bad records from Firestore...`);
            let deletedCount = 0;
            for (const id of idsToDelete) {
                // Double check id actually exists in our allInvoices array to prevent hallucinated deletions
                const exists = allInvoices.find(i => i.dbId === id);
                if (exists) {
                    console.log(`  -> Deleting duplicate: ${exists.vendorName} | ${exists.amount} EUR | ID: ${id}`);
                    await db.collection('invoices').doc(id).delete();
                    deletedCount++;
                } else {
                    console.log(`  -> Skipping hallucinated/invalid ID: ${id}`);
                }
            }
            console.log(`[Dashboard Auditor] 🧹 Successfully scrubbed ${deletedCount} records from the Dashboard!`);
        } else {
            console.log(`\n[Dashboard Auditor] 🌟 DATABASE IS 100% CLEAN. No anomalies detected by AI.`);
        }

    } catch (err) {
        console.error(`[Dashboard Auditor] Critical System Failure:`, err);
    }
}

module.exports = { runDashboardAudit };
